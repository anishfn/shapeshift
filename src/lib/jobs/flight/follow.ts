import { collapse } from "@/lib/parse/common";
import { isFlightEvent } from "./events";
import { OVERNIGHT_RULE, type TripJudgment } from "./judge";
import { labelOf, TRAVELLER_ALIASES } from "./profile";
import { type Option, type OptionTag, results } from "./rank";
import { localDate, nextDate } from "./say";
import { addDays, clockOf, dateOf, dayLabel, toMs, weekdayOf } from "./time";
import { type Disruption, disruptionAt, stageOf, type TripAction, type TripState } from "./trip";
import type { Airline, Profile, SeatPref, TripRequest } from "./types";

/**
 * A sentence said in the middle of the job, turned into the clicks it stands for. Which actions are
 * even possible depends on the stage, so the same words mean different things while choosing and
 * after a cancellation. Clauses ("the first one, aisle for mom") become actions in the order they
 * were said. A sentence that matches nothing produces nothing: guessing an action would spend money
 * or lose a choice.
 */

type Found = { index: number; action: TripAction };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const longestFirst = (words: string[]) => [...words].sort((a, b) => b.length - a.length).map(escape);

// ── Clocks ───────────────────────────────────────────────────────────────────

/** A clock as said. Without am/pm, "2:10" could be 02:10 or 14:10; without minutes, "2pm" is any 14:xx. */
export type Clock = { hours: number[]; minutes: number | null; index: number };

const CLOCK_RE = /\b(\d{1,2})[:.](\d{2})\s*(am|pm)?\b|\b(\d{1,2})\s*(am|pm)\b/g;

/** "14:10", "2:10pm", "2pm", "6.40", "6:40am": every clock in the text with the hours it could mean. */
export function clocksIn(text: string): Clock[] {
  const clocks: Clock[] = [];
  for (const m of text.matchAll(CLOCK_RE)) {
    const hour = Number(m[1] ?? m[4]);
    const minutes = m[2] === undefined ? null : Number(m[2]);
    const ampm = m[3] ?? m[5];
    if (hour > 23 || (minutes !== null && minutes > 59)) continue;
    const hours =
      ampm === "pm" ? [hour < 12 ? hour + 12 : hour] : ampm === "am" ? [hour % 12] : hour <= 12 ? [hour, (hour + 12) % 24] : [hour];
    clocks.push({ hours, minutes, index: m.index });
  }
  return clocks;
}

/** Whether a departure clock ("14:10") is one the person could have meant. */
export function clockMatches(clock: Clock, hhmm: string): boolean {
  const [h, m] = hhmm.split(":").map(Number);
  return clock.hours.includes(h) && (clock.minutes === null || clock.minutes === m);
}

// ── Words ────────────────────────────────────────────────────────────────────

const AIRLINE_WORDS: [RegExp, Airline][] = [
  [/\bair india\b/, "Air India"],
  [/\bindigo\b/, "IndiGo"],
  [/\bnepal(?: airlines?)?\b/, "Nepal Airlines"],
];
const ORDINALS: Record<string, number> = { first: 0, "1st": 0, second: 1, "2nd": 1, third: 2, "3rd": 2 };
const ORDINAL_RE = /\b(first|1st|second|2nd|third|3rd)\b/;
const TAG_WORDS: [RegExp, OptionTag][] = [
  [/\b(cheapest|cheaper|cheap|lowest|budget)\b/, "Cheapest"],
  [/\b(fastest|faster|fast|quickest|quick|shortest)\b/, "Fastest"],
  [/\b(balanced|best|recommended)\b/, "Best balance"],
];
const GO_BACK_RE =
  /\b(go back|back to (the )?options|the options again|other options|options again|show (me )?(the )?options|see (the )?options|start over|change (my )?(pick|choice|option))\b|^back$/;
const BOOK_RE = /\b(book( it| this| them)?|pay( now)?|confirm|go ahead|do it|yes|buy|purchase|check ?out)\b/;
const RELAX_RE =
  /\b(allow|allowed|fine|ok|okay|permit|accept|don'?t mind|doesn'?t matter|open to)\b[^,.;]{0,24}\b(overnight|red[- ]?eyes?|night)\b|\b(overnight|red[- ]?eyes?|nights?)\b[^,.;]{0,24}\b(fine|ok|okay|allowed|acceptable|alright)\b/;
const PRIORITY_WORDS: [RegExp, TripRequest["priority"]][] = [
  [/\b(cheapest|cheaper|cheap|price|budget)\s+first\b/, "cheapest"],
  [/\b(fastest|faster|fast|quickest|time)\s+first\b/, "fastest"],
  [/\bbalance\b/, "balanced"],
];
const DAY_TRIGGER = /\b(instead|leave|leaving|go|going|depart|departing|move|moving|shift|switch|change|on)\b/;
const WEEKDAY_RE = /\b(?:(next|this|coming)\s+)?(mon|tues?|wed|thu|thurs?|fri|sat|sun)(?:day|sday|nesday|rsday|urday)?\b/;
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const EVERYONE_WORDS = ["both of us", "all of us", "the two of us", "everyone", "both", "all", "us", "we"];

const ALIAS_TO_ID = new Map(Object.entries(TRAVELLER_ALIASES).flatMap(([id, aliases]) => aliases.map((a) => [a, id] as const)));

/** Blank a matched span so a later matcher cannot read the same words again ("cheapest first" is a priority, not a pick). */
const blank = (s: string, m: RegExpExecArray) => s.slice(0, m.index) + " ".repeat(m[0].length) + s.slice(m.index + m[0].length);

// ── Dates in follow-ups ──────────────────────────────────────────────────────

/** The date with this weekday closest to the trip's departure, never before today. */
function nearestWeekday(anchor: string, weekday: number, today: string): string {
  let delta = (weekday - weekdayOf(anchor) + 7) % 7;
  if (delta > 3) delta -= 7;
  let date = addDays(anchor, delta);
  while (date < today) date = addDays(date, 7);
  return date;
}

/** "the 8th" in the month the trip leaves, or the next month once that day has passed. */
function ordinalNear(anchor: string, day: number, today: string): string {
  const [y, m] = anchor.split("-").map(Number);
  const inMonth = (month: number) => new Date(Date.UTC(y, month, day)).toISOString().slice(0, 10);
  const same = inMonth(m - 1);
  return same >= today ? same : inMonth(m);
}

/**
 * A new departure date. A bare weekday ("thursday") is read around the day the trip already leaves,
 * because that is the week the person is looking at; anything more explicit ("next thursday",
 * "tomorrow", "oct 8") is read from today, as chrono does. Nothing in the past.
 */
function dateIn(clause: string, request: TripRequest, now: number): string | null {
  const today = localDate(new Date(now));
  const anchor = request.depart ?? today;
  const wd = WEEKDAY_RE.exec(clause);
  if (wd && !wd[1]) return nearestWeekday(anchor, WEEKDAYS.indexOf(wd[2].slice(0, 3)), today);
  const hit = nextDate(clause, new Date(now));
  if (hit) {
    const date = localDate(hit.hit.start);
    return date >= today ? date : null;
  }
  const ord = /\b(\d{1,2})(?:st|nd|rd|th)\b/.exec(clause);
  return ord ? ordinalNear(anchor, Number(ord[1]), today) : null;
}

// ── While choosing ───────────────────────────────────────────────────────────

function selectIn(clause: string, options: Option[]): Found | null {
  const select = (index: number, o: Option | undefined): Found | null => (o ? { index, action: { type: "select", optionId: o.id } } : null);
  const back = GO_BACK_RE.exec(clause);
  if (back) return { index: back.index, action: { type: "select", optionId: null } };
  const ord = ORDINAL_RE.exec(clause);
  if (ord) return select(ord.index, options[ORDINALS[ord[1]]]);
  for (const [re, tag] of TAG_WORDS) {
    const m = re.exec(clause);
    if (m)
      return select(
        m.index,
        options.find((o) => o.tag === tag),
      );
  }
  for (const [re, airline] of AIRLINE_WORDS) {
    const m = re.exec(clause);
    if (m)
      return select(
        m.index,
        options.find((o) => o.trip.out.segments.some((s) => s.airline === airline)),
      );
  }
  for (const clock of clocksIn(clause)) {
    const hit = select(
      clock.index,
      options.find((o) => clockMatches(clock, clockOf(o.trip.out.segments[0].dep))),
    );
    if (hit) return hit;
  }
  return null;
}

function seatsIn(clause: string, request: TripRequest, profile: Profile): Found[] {
  const names = longestFirst([...profile.travellers.flatMap((p) => TRAVELLER_ALIASES[p.id] ?? [p.id]), ...EVERYONE_WORDS]).join("|");
  const list = `(?:${names})(?:\\s*(?:,|and|&)\\s*(?:${names}))*`;
  const forRe = new RegExp(`\\b(aisle|window)\\b(?:\\s+seats?)?\\s+for\\s+(${list})\\b`, "g");
  const byRe = new RegExp(
    `\\b(${list})\\s+(?:by|at|on|near|wants?|prefers?|gets?|takes?|in)\\s+(?:the\\s+|an?\\s+)?(aisle|window)\\b`,
    "g",
  );

  const whoIs = (words: string): string[] => {
    const ids: string[] = [];
    for (const word of words.split(/\s*(?:,|\band\b|&)\s*/)) {
      const id = ALIAS_TO_ID.get(word.trim());
      for (const each of id ? [id] : EVERYONE_WORDS.includes(word.trim()) ? request.travellers : []) {
        if (request.travellers.includes(each) && !ids.includes(each)) ids.push(each);
      }
    }
    return ids;
  };
  const found: Found[] = [];
  for (const m of clause.matchAll(forRe)) {
    for (const id of whoIs(m[2])) found.push({ index: m.index, action: { type: "seat_pref", travellerId: id, pref: m[1] as SeatPref } });
  }
  for (const m of clause.matchAll(byRe)) {
    for (const id of whoIs(m[1])) found.push({ index: m.index, action: { type: "seat_pref", travellerId: id, pref: m[2] as SeatPref } });
  }
  return found;
}

function chooseActions(
  clause: string,
  request: TripRequest,
  options: Option[],
  profile: Profile,
  now: number,
  canBook: boolean,
): TripAction[] {
  const found: Found[] = [];
  let rest = clause;

  for (const [re, priority] of PRIORITY_WORDS) {
    const m = re.exec(rest);
    if (!m) continue;
    found.push({ index: m.index, action: { type: "refine", patch: { priority } } });
    rest = blank(rest, m);
  }
  const strict = OVERNIGHT_RULE.exec(rest);
  const relax = strict ? null : RELAX_RE.exec(rest);
  if (strict) found.push({ index: strict.index, action: { type: "refine", patch: { avoidOvernight: true } } });
  if (relax) found.push({ index: relax.index, action: { type: "refine", patch: { avoidOvernight: false } } });

  if (DAY_TRIGGER.test(rest)) {
    const depart = dateIn(rest, request, now);
    if (depart) found.push({ index: rest.search(DAY_TRIGGER), action: { type: "refine", patch: { depart } } });
  }

  found.push(...seatsIn(rest, request, profile));
  const pick = selectIn(rest, options);
  if (pick) found.push(pick);
  const book = canBook ? BOOK_RE.exec(rest) : null;
  if (book) found.push({ index: book.index, action: { type: "book", at: new Date(now).toISOString() } });

  return found.sort((a, b) => a.index - b.index).map((f) => f.action);
}

// ── After a disruption ───────────────────────────────────────────────────────

function fixIn(clause: string, d: Disruption): string | null {
  const fixes = d.fixes;
  const eventDate = isFlightEvent(d.event) ? d.event.date : dateOf(d.segment.dep);
  for (const clock of clocksIn(clause)) {
    const fix = fixes.find((f) => clockMatches(clock, clockOf(f.segment.dep)));
    if (fix) return fix.segment.flightNo;
  }
  for (const [re, airline] of AIRLINE_WORDS) {
    if (!re.test(clause)) continue;
    const fix = fixes.find((f) => f.segment.airline === airline);
    if (fix) return fix.segment.flightNo;
  }
  const ord = ORDINAL_RE.exec(clause);
  if (ord) return fixes[ORDINALS[ord[1]]]?.segment.flightNo ?? null;
  if (/\b(same day|today)\b/.test(clause)) return fixes.find((f) => dateOf(f.segment.dep) === eventDate)?.segment.flightNo ?? null;
  if (/\b(next day|tomorrow|day after)\b/.test(clause))
    return fixes.find((f) => dateOf(f.segment.dep) !== eventDate)?.segment.flightNo ?? null;
  return null;
}

// ── The sentence ─────────────────────────────────────────────────────────────

export function follow(text: string, judgment: TripJudgment, state: TripState, profile: Profile, now: number): TripAction[] {
  const t = collapse(text.replace(/[’‘]/g, "'")).toLowerCase();
  const at = new Date(now).toISOString();
  const clauses = t
    .split(/[,;]|\.(?=\s|$)|\bthen\b/)
    .map((c) => c.trim())
    .filter(Boolean);
  const stage = stageOf(state);
  const sure = <T extends string>(a: { value: T; confidence: number }) => (a.confidence >= 0.6 ? a.value : null);

  if (stage === "trip") {
    const d = state.booking ? disruptionAt(state.booking, now) : null;
    if (!d) return [];
    const rebook = (flightNo: string): TripAction => ({ type: "rebook", eventId: d.event.id, flightNo, at });
    for (const clause of clauses) {
      const flightNo = fixIn(clause, d);
      if (flightNo) return [rebook(flightNo)];
    }
    // Jev read it as taking a fix and named an ordinal, even though the words did not say which.
    const ordinal = sure(judgment.followUp) === "take_fix" ? ORDINALS[sure(judgment.optionPick) ?? ""] : undefined;
    const fix = ordinal === undefined ? undefined : d.fixes[ordinal];
    return fix ? [rebook(fix.segment.flightNo)] : [];
  }

  if (stage === "understand" || !state.request) return [];
  const request = state.request;
  const options = results(request).options;
  const actions = clauses.flatMap((clause) => chooseActions(clause, request, options, profile, now, stage === "confirm"));

  if (!actions.length) {
    const pick = sure(judgment.optionPick);
    const option =
      pick === null || pick === "none"
        ? undefined
        : pick in ORDINALS
          ? options[ORDINALS[pick]]
          : options.find((o) => o.tag.toLowerCase().includes(pick === "balanced" ? "balance" : pick));
    if (option) actions.push({ type: "select", optionId: option.id });
  }

  // Money moves last: a choice named in the same breath lands before the booking.
  return [...actions.filter((a) => a.type !== "book"), ...actions.filter((a) => a.type === "book")];
}

/** "Picks Best balance · aisle for Mom": what the sentence is about to do, for the preview under the box. */
export function describeFollow(actions: TripAction[], state: TripState, profile: Profile): string {
  const parts = actions.map((a) => {
    switch (a.type) {
      case "understood":
        return "searches";
      case "refine": {
        const p = a.patch;
        if (p.depart) return `leaves ${dayLabel(p.depart)}`;
        if (p.avoidOvernight === false) return "allows overnight layovers";
        if (p.avoidOvernight === true) return "no overnight layovers";
        if (p.priority) return p.priority === "balanced" ? "balances price and time" : `${p.priority} first`;
        return "changes that";
      }
      case "select": {
        if (a.optionId === null || !state.request) return "back to options";
        const option = results(state.request).options.find((o) => o.id === a.optionId);
        return option ? `picks ${option.tag}` : "picks that one";
      }
      case "seat_pref": {
        const who = labelOf(profile, a.travellerId);
        return `${a.pref} for ${who === "You" ? "you" : who}`;
      }
      case "book":
        return "books";
      case "rebook": {
        const d = state.booking ? disruptionAt(state.booking, toMs(a.at)) : null;
        const fix = d?.event.id === a.eventId ? d.fixes.find((f) => f.segment.flightNo === a.flightNo) : undefined;
        return fix ? `takes ${fix.segment.flightNo} at ${clockOf(fix.segment.dep)}` : `takes ${a.flightNo}`;
      }
      case "refare":
        return "takes the lower fare";
    }
  });
  const line = parts.join(" · ");
  return line.charAt(0).toUpperCase() + line.slice(1);
}
