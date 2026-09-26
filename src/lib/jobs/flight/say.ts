import { collapse, type DateHit, findDate, removeRange } from "@/lib/parse/common";
import { type AirportCode, findAirportsIn } from "./airports";
import { CHEAPEST_WORDS, CLOCK_WORDS, FASTEST_WORDS, OVERNIGHT_RULE, type Party, type TripJudgment, WHEELCHAIR_WORDS } from "./judge";
import { findTravellersIn, TRAVELLER_ALIASES } from "./profile";
import { addDays } from "./time";
import type { Assistance, Priority, Profile, TripRequest } from "./types";

/**
 * One sentence to a TripRequest. Every value is read by code: cities through the alias table, dates
 * through chrono, names through the traveller aliases. Jev's judgment only settles what words cannot
 * (whether the writer is going, who the wheelchair is for), and the deterministic reading always
 * wins when both have an opinion. Nothing is invented: a field with no evidence stays null.
 */

const pad = (n: number) => String(n).padStart(2, "0");

/** The calendar date chrono meant, from the local parts of the Date it returned. `toISOString` would shift it by the machine's zone. */
export const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ── Places ───────────────────────────────────────────────────────────────────

/**
 * A city after "to" (or an arrow, or "in") is the destination; after "from" it is the origin. Cities
 * with no preposition fill whichever is missing, first the origin when two are loose. A destination
 * with no origin means leaving from home, unless the destination is home itself.
 */
function places(t: string, home: AirportCode): Pick<TripRequest, "origin" | "destination"> {
  let origin: AirportCode | null = null;
  let destination: AirportCode | null = null;
  const loose: AirportCode[] = [];
  for (const hit of findAirportsIn(t)) {
    const before = t.slice(0, hit.index).trimEnd();
    if (/\b(via|through|thru)$/.test(before)) continue;
    if (/\bfrom$/.test(before)) origin ??= hit.code;
    else if (/\b(to|in|visit|visiting)$|[→\-]$|->$/.test(before)) destination ??= hit.code;
    else loose.push(hit.code);
  }
  if (!destination && !origin && loose.length >= 2) [origin, destination] = loose;
  else if (!destination && loose.length) destination = loose[0];
  else if (!origin && loose.length) origin = loose[0];
  if (destination && !origin && destination !== home) origin = home;
  if (origin && origin === destination) origin = null;
  return { origin, destination };
}

// ── Dates ────────────────────────────────────────────────────────────────────

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};
const STAY_RE = /\bfor\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d{1,2})\s+(days?|nights?|weeks?)\b/;
const WEEKEND_RE = /\b(?:(this|next|coming)\s+)?weekend\b/;
const RETURN_WORDS = /\b(back|return(?:ing|s)?|till|until|thru|through)\b/;
/** "back on the 25th", "till the 25th": a bare day that chrono will not read on its own. */
const RETURN_DAY_RE =
  /\b(?:back|return(?:ing|s)?|till|until|thru|through)\s+(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\b(?![:.]\d|\s*(?:am|pm|days?|nights?|weeks?))/;
const ORDINAL_DAY_RE = /\b(\d{1,2})(?:st|nd|rd|th)\b/;
const PURE_TIME_RE = /^\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?$/;

/** A clock on its own ("the 14:10 one") is not a date. */
export const isClockOnly = (hit: DateHit) =>
  PURE_TIME_RE.test(hit.text.trim()) || (hit.hasTime && CLOCK_WORDS.test(hit.text) && !/[a-z]{3}/i.test(hit.text.replace(/am|pm/gi, "")));

/** The first calendar date in the text, and the text with it blanked so the next one can be found. */
export function nextDate(text: string, ref: Date): { hit: DateHit; rest: string } | null {
  let rest = text;
  for (let i = 0; i < 4; i++) {
    const hit = findDate(rest, ref);
    if (!hit) return null;
    rest = removeRange(rest, hit.index, hit.text.length);
    if (!isClockOnly(hit)) return { hit, rest };
  }
  return null;
}

/** The coming Sat–Sun. "next weekend" only skips a week when today already touches one, which is how people mean it mid-week. */
function weekend(ref: Date, next: boolean): [string, string] {
  const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  const day = d.getDay();
  const sat = new Date(d);
  sat.setDate(d.getDate() + (day === 0 ? 6 : 6 - day));
  if (next && (day === 5 || day === 6 || day === 0)) sat.setDate(sat.getDate() + 7);
  const sun = new Date(sat);
  sun.setDate(sat.getDate() + 1);
  return [localDate(sat), localDate(sun)];
}

/** The day-of-month nearest after (or on) an anchor date: this month if it is still ahead, else next month. */
export function dayOfMonth(anchor: string, day: number, allowSame: boolean): string {
  const [y, m] = anchor.split("-").map(Number);
  const inMonth = (month: number) => new Date(Date.UTC(y, month, day)).toISOString().slice(0, 10);
  const first = inMonth(m - 1);
  return first > anchor || (allowSame && first === anchor) ? first : inMonth(m);
}

function dates(text: string, ref: Date): Pick<TripRequest, "depart" | "back"> {
  let d = text;
  let depart: string | null = null;
  let back: string | null = null;
  let stay: number | null = null;

  const stayHit = STAY_RE.exec(d);
  if (stayHit) {
    const n = NUMBER_WORDS[stayHit[1]] ?? Number(stayHit[1]);
    stay = stayHit[2].startsWith("week") ? n * 7 : n;
    d = removeRange(d, stayHit.index, stayHit[0].length);
  }

  const weekendHit = WEEKEND_RE.exec(d);
  if (weekendHit) {
    [depart, back] = weekend(ref, weekendHit[1] === "next");
    d = removeRange(d, weekendHit.index, weekendHit[0].length);
  }

  if (!depart) {
    const first = nextDate(d, ref);
    if (first) {
      depart = localDate(first.hit.start);
      d = first.rest;
      if (first.hit.end) back = localDate(first.hit.end);
      else {
        const second = nextDate(d, ref);
        const between = second ? d.slice(first.hit.index, second.hit.index) : "";
        if (second && (RETURN_WORDS.test(between) || /^\s*(?:to|-|–|—)\s*$/.test(between))) back = localDate(second.hit.start);
        const day = RETURN_DAY_RE.exec(d);
        if (!back && day) back = dayOfMonth(depart, Number(day[1]), false);
      }
    } else {
      const day = ORDINAL_DAY_RE.exec(d);
      if (day) depart = dayOfMonth(localDate(ref), Number(day[1]), true);
    }
  }

  if (depart && !back && stay !== null) back = addDays(depart, stay);
  if (depart && back && back <= depart) back = null;
  return { depart, back };
}

// ── People ───────────────────────────────────────────────────────────────────

const aliasWords = (ids: string[]) =>
  ids
    .flatMap((id) => TRAVELLER_ALIASES[id] ?? [id])
    .sort((a, b) => b.length - a.length)
    .map(escape);

/** "mom needs to fly", "book … for mom": the writer is arranging, not going. */
function othersOnlyPhrase(t: string, others: string[]): boolean {
  const names = aliasWords(others).join("|");
  return new RegExp(
    `\\b(?:${names})\\b[^,.;]{0,16}\\b(?:needs?|has|have|wants?)\\s+to\\s+(?:go|fly|travel)\\b|^\\s*(?:please\\s+)?book\\b[^,.;]*\\bfor\\s+(?:${names})\\b`,
  ).test(t);
}

/**
 * Who is going, "me" first. Names come from the aliases. When no one is named, the writer is going
 * if Jev says so, or if the sentence reads as a trip request at all. When names are given without
 * the writer, they are along only when the sentence says so ("we", "us", "with mom") or Jev is sure.
 */
function travellers(t: string, judgment: TripJudgment, profile: Profile, destination: AirportCode | null): string[] {
  const known = new Set(profile.travellers.map((p) => p.id));
  const found = findTravellersIn(t).filter((id) => known.has(id));
  const others = found.filter((id) => id !== "me");
  const me = known.has("me") ? ["me"] : [];
  const party = judgment.party;
  const sure = (value: Party) => party.value === value && party.confidence >= 0.6;

  if (!found.length) {
    if (party.value === "others_only") return [];
    if (party.value === "self" || party.value === "self_and_others") return me;
    return judgment.wantsFlight >= 0.5 && destination ? me : [];
  }
  if (found.includes("me") || sure("self_and_others")) return [...me, ...others];
  if (sure("others_only")) return others;
  const withName = new RegExp(`\\bwith\\s+(?:${aliasWords(others).join("|")})\\b`).test(t);
  const writerToo = (/\b(we|us)\b/.test(t) || withName) && !othersOnlyPhrase(t, others);
  return writerToo ? [...me, ...others] : others;
}

const PRONOUNS = /\b(she|he|they|her|him|them)\b/;
const EVERYONE = /\b(both|everyone|all of us|each of us|we all|we|us)\b/;

/**
 * Who the wheelchair is for. Read from the clause that mentions it: a name, a pronoun (the people
 * who are not the writer), the writer, or everyone. Jev's judgment only fills in when the words gave
 * nothing, which is also how "mom is 80 and frail" can become a wheelchair without the word.
 */
function assistance(t: string, judgment: TripJudgment, going: string[]): Partial<Record<string, Assistance>> {
  const out: Partial<Record<string, Assistance>> = {};
  const give = (ids: string[]) => {
    for (const id of ids) if (going.includes(id)) out[id] = "wheelchair";
  };
  const others = going.filter((id) => id !== "me");

  for (const clause of t.split(/[,;.]|\bbut\b/)) {
    if (!WHEELCHAIR_WORDS.test(clause)) continue;
    const named = findTravellersIn(clause).filter((id) => going.includes(id));
    if (named.length) give(named);
    else if (PRONOUNS.test(clause)) give(others);
    else if (/\bmy\b/.test(clause)) give(["me"]);
    else if (EVERYONE.test(clause)) give(going);
    else if (going.length === 1) give(going);
  }

  if (!Object.keys(out).length && judgment.assistanceFor.confidence >= 0.6) {
    switch (judgment.assistanceFor.value) {
      case "self":
        give(["me"]);
        break;
      case "companion":
        give(others);
        break;
      case "everyone":
        give(going);
        break;
      case "nobody":
        break;
    }
  }
  return out;
}

// ── The sentence ─────────────────────────────────────────────────────────────

export function say(text: string, judgment: TripJudgment, profile: Profile, ref: Date): TripRequest {
  const t = collapse(text.replace(/[’‘]/g, "'")).toLowerCase();
  const { origin, destination } = places(t, profile.home);
  const { depart, back } = dates(t, ref);
  const going = travellers(t, judgment, profile, destination);
  const judged = judgment.priority;
  const priority: Priority = CHEAPEST_WORDS.test(t)
    ? "cheapest"
    : FASTEST_WORDS.test(t)
      ? "fastest"
      : judged.confidence >= 0.6 && judged.value !== "balanced"
        ? judged.value
        : "balanced";
  return {
    origin,
    destination,
    depart,
    back,
    travellers: going,
    assistance: assistance(t, judgment, going),
    avoidOvernight: OVERNIGHT_RULE.test(t) || judgment.avoidsOvernight >= 0.65,
    priority,
  };
}

/** How much of a searchable request the sentence has given: where to, when, who, where from. */
export function sayCompleteness(req: TripRequest): number {
  return ((req.destination ? 40 : 0) + (req.depart ? 30 : 0) + (req.travellers.length ? 20 : 0) + (req.origin ? 10 : 0)) / 100;
}

/** Whether the text box is talking about a trip at all: Jev thinks so, or a city and a date are both there. */
export function isTripSentence(text: string, judgment: TripJudgment): boolean {
  if (judgment.wantsFlight >= 0.6) return true;
  const t = collapse(text).toLowerCase();
  return findAirportsIn(t).length > 0 && (nextDate(t, new Date()) !== null || WEEKEND_RE.test(t) || ORDINAL_DAY_RE.test(t));
}
