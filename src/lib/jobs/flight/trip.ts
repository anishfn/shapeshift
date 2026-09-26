import { formatAmount } from "@/lib/parse/common";
import { type AirportCode, cityOf, offsetOf } from "./airports";
import { CONNECTION, type Flag, isLate, needsWheelchair, sortFlags, spansNight } from "./checks";
import { type AirlineEvent, DEMO_EVENTS, eventById } from "./events";
import { searchFlights } from "./inventory";
import { joinLabels, labelOf } from "./profile";
import { type Option, results } from "./rank";
import { addDays, clockOf, dateOf, dayLabel, formatDuration, HOUR, MINUTE, minutesBetween, toMs, wallClock } from "./time";
import type { Itinerary, Profile, SeatPref, Segment, Trip, TripRequest } from "./types";

/**
 * The flight job as a pure state machine. The stage is derived from state and never stored, so
 * changing an earlier answer walks the UI back on its own. The clock is an input: the same booking
 * reads as booked, checked in, travelling or home depending on `now`, and every airline event, every
 * rebooking and every fare change only counts once the clock has passed it.
 */

export type Stage = "understand" | "choose" | "confirm" | "trip";
export const STAGES: Stage[] = ["understand", "choose", "confirm", "trip"];

/** One flight swapped for another because of an event. `paid` is the extra spent, total for everyone. */
export type Change = { eventId: string; replaced: { flightNo: string; date: string }; segment: Segment; at: string; paid: number };

/** The same flights bought again at a lower fare. */
export type Refare = { eventId: string; saved: number; at: string };

/** What was bought. A snapshot: later searches never rewrite it, only airline events and decisions do. */
export type Booking = {
  pnr: string;
  trip: Trip;
  total: number;
  travellers: string[];
  assistance: TripRequest["assistance"];
  avoidOvernight: boolean;
  seatPrefs: Partial<Record<string, SeatPref>>;
  bookedAt: string;
  changes: Change[];
  refares: Refare[];
};

export type TripState = {
  request: TripRequest | null;
  seatPrefs: Partial<Record<string, SeatPref>>;
  selectedId: string | null;
  booking: Booking | null;
};

/** Clicks and sentences both become one of these. The reducer never knows which it was. */
export type TripAction =
  | { type: "understood"; request: TripRequest }
  | { type: "refine"; patch: Partial<TripRequest> }
  | { type: "select"; optionId: string | null }
  | { type: "seat_pref"; travellerId: string; pref: SeatPref }
  | { type: "book"; at: string }
  | { type: "rebook"; eventId: string; flightNo: string; at: string }
  | { type: "refare"; eventId: string; at: string };

export const initialTrip: TripState = { request: null, seatPrefs: {}, selectedId: null, booking: null };

export function stageOf(state: TripState): Stage {
  if (state.booking) return "trip";
  if (!state.request) return "understand";
  return state.selectedId ? "confirm" : "choose";
}

export function selectedOption(state: TripState): Option | null {
  if (!state.request || !state.selectedId) return null;
  return results(state.request).options.find((o) => o.id === state.selectedId) ?? null;
}

export function reduceTrip(state: TripState, action: TripAction, events: AirlineEvent[] = DEMO_EVENTS): TripState {
  switch (action.type) {
    case "understood":
      if (state.booking) return state;
      return { ...state, request: action.request, selectedId: null };

    case "refine": {
      if (!state.request || state.booking) return state;
      const request = { ...state.request, ...action.patch };
      // A choice that no longer exists under the new answers is dropped, and the stage falls back.
      const kept = state.selectedId !== null && results(request).options.some((o) => o.id === state.selectedId);
      return { ...state, request, selectedId: kept ? state.selectedId : null };
    }

    case "select": {
      if (!state.request || state.booking) return state;
      if (action.optionId === null) return { ...state, selectedId: null };
      return results(state.request).options.some((o) => o.id === action.optionId) ? { ...state, selectedId: action.optionId } : state;
    }

    case "seat_pref":
      if (state.booking) return state;
      return { ...state, seatPrefs: { ...state.seatPrefs, [action.travellerId]: action.pref } };

    case "book": {
      // The only action that spends money on its own. It needs a request, a live choice, and no booking yet.
      const option = selectedOption(state);
      if (state.booking || !state.request || !option) return state;
      return {
        ...state,
        booking: {
          pnr: pnrOf(option.id),
          trip: option.trip,
          total: option.total,
          travellers: state.request.travellers,
          assistance: state.request.assistance,
          avoidOvernight: state.request.avoidOvernight,
          seatPrefs: state.seatPrefs,
          bookedAt: action.at,
          changes: [],
          refares: [],
        },
      };
    }

    case "rebook": {
      const { booking } = state;
      const event = eventById(events, action.eventId);
      const now = toMs(action.at);
      if (!booking || !event || toMs(event.at) > now || booking.changes.some((c) => c.eventId === event.id)) return state;
      const disruption = disruptionFor(booking, event, now, events);
      const fix = disruption?.fixes.find((f) => f.segment.flightNo === action.flightNo);
      if (!disruption || !fix) return state;
      const change: Change = {
        eventId: event.id,
        replaced: { flightNo: disruption.segment.flightNo, date: dateOf(disruption.segment.dep) },
        segment: fix.segment,
        at: action.at,
        paid: fix.costPerPerson * booking.travellers.length,
      };
      return { ...state, booking: { ...booking, changes: [...booking.changes, change] } };
    }

    case "refare": {
      const { booking } = state;
      if (!booking) return state;
      const proposal = proposalAt(booking, toMs(action.at), events);
      if (!proposal || proposal.event.id !== action.eventId) return state;
      return {
        ...state,
        booking: { ...booking, refares: [...booking.refares, { eventId: action.eventId, saved: proposal.net, at: action.at }] },
      };
    }
  }
}

// ── Booking identity ─────────────────────────────────────────────────────────

const PNR_CHARS = "ACDEFGHJKMNPQRTUVWXY34679";

function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0;
  return h;
}

/** A stable, readable six-character booking reference. */
export function pnrOf(seed: string): string {
  let h = hash(seed);
  let pnr = "";
  for (let i = 0; i < 6; i++) {
    h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
    pnr += PNR_CHARS[h % PNR_CHARS.length];
  }
  return pnr;
}

// ── The trip as it stands now ────────────────────────────────────────────────

type OfKind<K extends AirlineEvent["kind"]> = Extract<AirlineEvent, { kind: K }>;
type FareDrop = OfKind<"fare_drop">;

/** Events of one kind that have already happened. */
const known = <K extends AirlineEvent["kind"]>(events: AirlineEvent[], kind: K, now: number): OfKind<K>[] =>
  events.filter((e): e is OfKind<K> => e.kind === kind && toMs(e.at) <= now);

/** The booked flights with every rebooking and every announced delay applied, as of `now`. */
export function currentTrip(booking: Booking, now: number, events: AirlineEvent[] = DEMO_EVENTS): Trip {
  const changes = booking.changes.filter((c) => toMs(c.at) <= now);
  const delays = known(events, "delayed", now);
  if (!changes.length && !delays.length) return booking.trip;
  const swap = (it: Itinerary): Itinerary => ({
    ...it,
    segments: it.segments.map((sold) => {
      const s = changes.find((c) => c.replaced.flightNo === sold.flightNo && c.replaced.date === dateOf(sold.dep))?.segment ?? sold;
      const late = delays.find((e) => e.flightNo === s.flightNo && e.date === dateOf(s.dep));
      if (!late) return s;
      return {
        ...s,
        dep: late.newDep,
        arr: late.newArr,
        delay: { minutes: minutesBetween(s.dep, late.newDep), reason: late.reason, scheduledDep: s.dep, scheduledArr: s.arr },
      };
    }),
  });
  return { ...booking.trip, out: swap(booking.trip.out), back: booking.trip.back && swap(booking.trip.back) };
}

export type Direction = "out" | "back";
type Hit = { it: Itinerary; direction: Direction; index: number };

/** Where a flight sits in the trip, matched by number and the date it was sold for. */
function locate(trip: Trip, flightNo: string, date: string): Hit | null {
  const sides: [Direction, Itinerary | null][] = [
    ["out", trip.out],
    ["back", trip.back],
  ];
  for (const [direction, it] of sides) {
    if (!it) continue;
    const index = it.segments.findIndex((s) => s.flightNo === flightNo && dateOf(s.delay?.scheduledDep ?? s.dep) === date);
    if (index >= 0) return { it, direction, index };
  }
  return null;
}

/** What the trip has cost so far: the fare, plus flights bought after a disruption, minus fares taken lower. */
export function spent(booking: Booking, now = Number.POSITIVE_INFINITY) {
  const extra = booking.changes.filter((c) => toMs(c.at) <= now).reduce((sum, c) => sum + c.paid, 0);
  const saved = booking.refares.filter((r) => toMs(r.at) <= now).reduce((sum, r) => sum + r.saved, 0);
  return { total: booking.total, extra, saved, net: booking.total + extra - saved };
}

export const CHECKIN_OPENS = 48 * HOUR;
/** "Travel day" starts four hours before the first flight. */
export const TRAVEL_WINDOW = 4 * HOUR;
/** Leave home 2h 10m before a domestic departure with assistance. */
export const LEAVE_HOME = 130 * MINUTE;
export const BOARDING = 40 * MINUTE;

const first = (it: Itinerary) => it.segments[0];
const last = (it: Itinerary) => it.segments[it.segments.length - 1];

export function milestones(booking: Booking, now: number, events: AirlineEvent[] = DEMO_EVENTS) {
  const trip = currentTrip(booking, now, events);
  const outDep = toMs(first(trip.out).dep);
  const backDep = trip.back ? toMs(first(trip.back).dep) : null;
  return {
    booked: toMs(booking.bookedAt),
    outCheckin: outDep - CHECKIN_OPENS,
    leaveHome: outDep - LEAVE_HOME,
    outDep,
    outArr: toMs(last(trip.out).arr),
    backCheckin: backDep === null ? null : backDep - CHECKIN_OPENS,
    leaveForAirport: backDep === null ? null : backDep - LEAVE_HOME,
    backDep,
    backArr: trip.back ? toMs(last(trip.back).arr) : null,
  };
}

export type Phase = "booked" | "checkin" | "flyout" | "away" | "flyback" | "home";

const PHASE_LABEL: Record<Phase, string> = {
  booked: "Booked",
  checkin: "Check-in",
  flyout: "Fly out",
  away: "Away",
  flyback: "Fly back",
  home: "Home",
};

export function phasesFor(booking: Booking): { id: Phase; label: string }[] {
  const ids: Phase[] = booking.trip.back
    ? ["booked", "checkin", "flyout", "away", "flyback", "home"]
    : ["booked", "checkin", "flyout", "away"];
  return ids.map((id) => ({ id, label: id === "away" && !booking.trip.back ? "Arrived" : PHASE_LABEL[id] }));
}

export function phaseOf(booking: Booking, now: number, events: AirlineEvent[] = DEMO_EVENTS): Phase {
  const m = milestones(booking, now, events);
  if (now < m.outCheckin) return "booked";
  if (now < m.outDep - TRAVEL_WINDOW) return "checkin";
  if (now < m.outArr) return "flyout";
  if (m.backDep === null || m.backArr === null || now < m.backDep - TRAVEL_WINDOW) return "away";
  if (now < m.backArr) return "flyback";
  return "home";
}

// ── Seats ────────────────────────────────────────────────────────────────────

const NEIGHBOURS: Record<string, string[]> = { A: ["B"], B: ["A", "C"], C: ["B"], D: ["E"], E: ["D", "F"], F: ["E"] };
const FALLBACK = ["C", "B", "D", "E", "A", "F"];

/**
 * Seats for everyone on one flight. Whoever needs assistance boards near the front; companions sit
 * beside them unless they asked for something else.
 */
export function seatsOn(booking: Pick<Booking, "travellers" | "assistance" | "seatPrefs">, segment: Segment): Record<string, string> {
  const helped = booking.travellers.filter((id) => booking.assistance[id]);
  const order = [...helped, ...booking.travellers.filter((id) => !booking.assistance[id])];
  const row = (helped.length ? 3 : 14) + (hash(segment.flightNo) % 3);
  const taken: string[] = [];
  const seats: Record<string, string> = {};
  for (const id of order) {
    const pref = booking.seatPrefs[id];
    const wanted =
      pref === "window" ? ["A", "F"] : pref === "aisle" ? ["C", "D"] : [...taken.flatMap((letter) => NEIGHBOURS[letter]), ...FALLBACK];
    const letter = [...wanted, ...FALLBACK].find((l) => !taken.includes(l)) ?? "F";
    taken.push(letter);
    seats[id] = `${row}${letter}`;
  }
  return seats;
}

// ── Disruptions ──────────────────────────────────────────────────────────────

/** A replacement flight. `costPerPerson` is zero when the airline owes you the seat. */
export type Fix = { segment: Segment; flags: Flag[]; minutesLater: number; costPerPerson: number };

export type Disruption = {
  kind: "cancelled" | "missed_connection";
  event: AirlineEvent;
  direction: Direction;
  /** The flight that needs replacing. */
  segment: Segment;
  /** For a missed connection: the late flight that caused it, and the minutes that were left to connect. */
  cause: { segment: Segment; minutes: number } | null;
  /** One ticket: the airline moves you for free. Two tickets: the next flight is yours to buy. */
  protected: boolean;
  fixes: Fix[];
};

/**
 * Replacement flights for one leg, ranked so the ones that keep every constraint come first. A fix
 * that breaks something you asked for says so in words, and one you have to pay for says how much.
 */
function replacementsFor(
  booking: Booking,
  target: Segment,
  prev: Segment | null,
  next: Segment | null,
  ready: string,
  isProtected: boolean,
): Fix[] {
  const wheelchair = needsWheelchair(booking);
  const minimum = wheelchair ? CONNECTION.withWheelchair : CONNECTION.comfortable;
  const city = cityOf(target.from);
  const date = dateOf(target.dep);

  const fixes: Fix[] = [];
  for (const flight of [0, 1].flatMap((d) => searchFlights(target.from, target.to, addDays(date, d)))) {
    if (flight.flightNo === target.flightNo && dateOf(flight.dep) === date) continue;
    if (wheelchair && !flight.wheelchair) continue;
    const wait = minutesBetween(ready, flight.dep);
    if (wait < CONNECTION.hard) continue;
    if (next && minutesBetween(flight.arr, next.dep) < CONNECTION.hard) continue;

    const flags: Flag[] = [];
    if (prev && spansNight(prev.arr, flight.dep, offsetOf(target.from))) {
      flags.push({
        kind: "overnight",
        level: "warn",
        text: booking.avoidOvernight ? `One night in ${city}, breaks your no-overnight rule` : `One night in ${city}`,
      });
    } else if (prev && wait < minimum) {
      flags.push({
        kind: "tight_connection",
        level: "warn",
        text: `${formatDuration(wait)} to connect, tight${wheelchair ? " with a wheelchair" : ""}`,
      });
    }
    if (isLate(flight.arr)) flags.push({ kind: "late_arrival", level: "warn", text: `Lands ${clockOf(flight.arr)}` });
    if (!flags.length) {
      flags.push({
        kind: "all_kept",
        level: "ok",
        text: wheelchair ? "Wheelchair, seats and bags move with you" : "Seats and bags move with you",
      });
    }
    fixes.push({
      segment: flight,
      flags: sortFlags(flags),
      minutesLater: minutesBetween(target.arr, flight.arr),
      costPerPerson: isProtected ? 0 : flight.fare,
    });
  }

  const cost = (f: Fix) =>
    f.flags.reduce((sum, flag) => sum + (flag.level !== "warn" ? 0 : flag.kind === "overnight" && booking.avoidOvernight ? 40 : 10), 0) +
    Math.max(0, f.minutesLater) / 60;
  return fixes.sort((a, b) => cost(a) - cost(b)).slice(0, 3);
}

/**
 * What one event does to this booking as of `now`. A cancellation always needs a new flight. A delay
 * only matters when it leaves too little time for the next flight; then it is that next flight that
 * gets replaced, and whether the airline pays depends on how the trip was ticketed.
 */
export function disruptionFor(booking: Booking, event: AirlineEvent, now: number, events: AirlineEvent[] = DEMO_EVENTS): Disruption | null {
  if (event.kind !== "cancelled" && event.kind !== "delayed") return null;
  const hit = locate(currentTrip(booking, now, events), event.flightNo, event.date);
  if (!hit) return null;
  const { it, direction, index } = hit;
  const segment = it.segments[index];
  if (event.kind === "cancelled") {
    const prev = it.segments[index - 1] ?? null;
    const next = it.segments[index + 1] ?? null;
    const fixes = replacementsFor(booking, segment, prev, next, prev ? prev.arr : event.at, true);
    return { kind: "cancelled", event, direction, segment, cause: null, protected: true, fixes };
  }
  const next = it.segments[index + 1];
  if (!next) return null;
  const minutes = minutesBetween(segment.arr, next.dep);
  if (minutes >= CONNECTION.hard) return null;
  const isProtected = it.ticketing === "single";
  const fixes = replacementsFor(booking, next, segment, it.segments[index + 2] ?? null, segment.arr, isProtected);
  return { kind: "missed_connection", event, direction, segment: next, cause: { segment, minutes }, protected: isProtected, fixes };
}

const byTime = (events: AirlineEvent[]) => [...events].sort((a, b) => toMs(a.at) - toMs(b.at));

/** The disruption that needs a decision right now, if any. A decision made later than `now` has not happened yet. */
export function disruptionAt(booking: Booking, now: number, events: AirlineEvent[] = DEMO_EVENTS): Disruption | null {
  const booked = toMs(booking.bookedAt);
  for (const event of byTime(events)) {
    const at = toMs(event.at);
    if (at > now || at < booked) continue;
    if (booking.changes.some((c) => c.eventId === event.id && toMs(c.at) <= now)) continue;
    const disruption = disruptionFor(booking, event, now, events);
    if (disruption) return disruption;
  }
  return null;
}

// ── Money that could move ────────────────────────────────────────────────────

/** A cheaper fare for flights you already hold. `net` is what you would keep after the change fee. */
export type Proposal = { event: FareDrop; direction: Direction; drop: number; fee: number; net: number };

function fareDropOf(booking: Booking, event: FareDrop): Proposal | null {
  const direction: Direction | null =
    booking.trip.out.id === event.itineraryId ? "out" : booking.trip.back?.id === event.itineraryId ? "back" : null;
  if (!direction) return null;
  const it = direction === "out" ? booking.trip.out : booking.trip.back;
  if (!it) return null;
  const people = booking.travellers.length;
  const drop = (it.farePerPerson - event.farePerPerson) * people;
  const fee = it.changeFee * people;
  return { event, direction, drop, fee, net: drop - fee };
}

/** A fare drop worth taking that has not been taken yet. Money moves only when the person says so. */
export function proposalAt(booking: Booking, now: number, events: AirlineEvent[] = DEMO_EVENTS): Proposal | null {
  for (const event of known(events, "fare_drop", now)) {
    if (toMs(event.at) < toMs(booking.bookedAt) || booking.refares.some((r) => r.eventId === event.id)) continue;
    const proposal = fareDropOf(booking, event);
    if (proposal && proposal.net > 0) return proposal;
  }
  return null;
}

// ── What the trip card says ──────────────────────────────────────────────────

export type Moment = { id: string; at: number; status: "done" | "next"; text: string };

type Entry = { id: string; at: number; done: string | null; next: string | null };

/** Everything that has happened and will happen, as sentences. The card shows the recent past and the near future. */
export function momentsOf(booking: Booking, now: number, events: AirlineEvent[] = DEMO_EVENTS): Moment[] {
  const m = milestones(booking, now, events);
  const trip = currentTrip(booking, now, events);
  const booked = toMs(booking.bookedAt);
  // While a broken flight waits for a decision, the old landing time is not a promise.
  const pending = disruptionAt(booking, now, events);
  const home = first(trip.out).from;
  const away = last(trip.out).to;
  const people = booking.travellers.length;
  const everyone = people === 1 ? "you" : people === 2 ? "both of you" : `all ${people} of you`;
  const when = (ms: number, code: AirportCode) => {
    const w = wallClock(ms, offsetOf(code));
    return `${dayLabel(w.date)} at ${w.clock}`;
  };
  const by = (ms: number, code: AirportCode) => when(ms, code).replace(" at ", " by ");

  const entries: Entry[] = [
    { id: "booked", at: m.booked, done: `Booked · PNR ${booking.pnr}`, next: null },
    { id: "calendar", at: m.booked, done: "Added to your calendar", next: null },
    {
      id: "checkin-out",
      at: m.outCheckin,
      done: `Checked in for ${everyone}`,
      next: `Check-in happens on its own, ${when(m.outCheckin, home)}`,
    },
    ...(needsWheelchair(booking)
      ? [{ id: "assist-out", at: m.outCheckin, done: "Wheelchair confirmed at every airport", next: null }]
      : []),
    { id: "leave-home", at: m.leaveHome, done: null, next: `Leave home ${by(m.leaveHome, home)}` },
    {
      id: "landed-out",
      at: m.outArr,
      done: `Landed in ${cityOf(away)} at ${clockOf(last(trip.out).arr)}`,
      next:
        pending?.direction === "out" ? "New landing time comes with the fix you pick" : `Land in ${cityOf(away)} ${when(m.outArr, away)}`,
    },
  ];
  if (trip.back && m.backCheckin !== null && m.leaveForAirport !== null && m.backArr !== null) {
    entries.push(
      {
        id: "checkin-back",
        at: m.backCheckin,
        done: "Checked in for your return",
        next: `Return check-in happens on its own, ${when(m.backCheckin, away)}`,
      },
      { id: "leave-back", at: m.leaveForAirport, done: null, next: `Leave for the airport ${by(m.leaveForAirport, away)}` },
      {
        id: "landed-back",
        at: m.backArr,
        done: `Home in ${cityOf(home)} at ${clockOf(last(trip.back).arr)}`,
        next: pending?.direction === "back" ? "New arrival time comes with the fix you pick" : `Home ${when(m.backArr, home)}`,
      },
    );
  }

  // The world's events, in the words of what they did to this trip.
  for (const e of byTime(events)) {
    const at = toMs(e.at);
    if (at > now || at < booked) continue;
    switch (e.kind) {
      case "cancelled": {
        const hit = locate(currentTrip(booking, at, events), e.flightNo, e.date);
        if (hit)
          entries.push({
            id: `event-${e.id}`,
            at,
            done: `${e.flightNo} to ${cityOf(hit.it.segments[hit.index].to)} cancelled`,
            next: null,
          });
        break;
      }
      case "delayed": {
        const hit = locate(currentTrip(booking, at, events), e.flightNo, e.date);
        if (!hit) break;
        const s = hit.it.segments[hit.index];
        const next = hit.it.segments[hit.index + 1];
        const left = next ? minutesBetween(s.arr, next.dep) : null;
        const tail =
          left === null || !next
            ? `lands ${clockOf(s.arr)}`
            : left < CONNECTION.hard
              ? `misses ${next.flightNo} in ${cityOf(next.from)}`
              : `${formatDuration(left)} to connect, still fine`;
        entries.push({
          id: `event-${e.id}`,
          at,
          done: `${e.flightNo} delayed ${formatDuration(s.delay?.minutes ?? 0)}, ${e.reason} · ${tail}`,
          next: null,
        });
        break;
      }
      case "gate":
        if (locate(trip, e.flightNo, e.date))
          entries.push({ id: `event-${e.id}`, at, done: `Gate ${e.gate} for ${e.flightNo}`, next: null });
        break;
      case "fare_drop": {
        const p = fareDropOf(booking, e);
        if (!p) break;
        const taken = booking.refares.find((r) => r.eventId === e.id);
        const done = taken
          ? `Took the lower fare · saved ${formatAmount(taken.saved)}`
          : p.net > 0
            ? null
            : `Fare dropped ${formatAmount(p.drop)} · change fee ${formatAmount(p.fee)} · left alone`;
        entries.push({ id: `event-${e.id}`, at, done, next: null });
        break;
      }
    }
  }

  for (const c of booking.changes) {
    const seats = Object.values(seatsOn(booking, c.segment)).sort().join(" and ");
    entries.push({
      id: `change-${c.eventId}`,
      at: toMs(c.at),
      done: `Moved to ${c.segment.flightNo} at ${clockOf(c.segment.dep)} · seats ${seats}${c.paid ? ` · paid ${formatAmount(c.paid)}` : ""}`,
      next: null,
    });
  }

  return entries
    .flatMap((e): Moment[] => {
      const done = e.at <= now;
      const text = done ? e.done : e.next;
      return text ? [{ id: e.id, at: e.at, status: done ? "done" : "next", text }] : [];
    })
    .sort((a, b) => a.at - b.at);
}

export type Pass = {
  travellerId: string;
  label: string;
  flightNo: string;
  route: string;
  seat: string;
  boards: string;
  gate: string | null;
  delay: string | null;
  note: string | null;
};

/** Boarding passes for the next flight, once check-in has happened and until that journey ends. */
export function passesAt(booking: Booking, now: number, profile: Profile, events: AirlineEvent[] = DEMO_EVENTS): Pass[] {
  const m = milestones(booking, now, events);
  const trip = currentTrip(booking, now, events);
  const it =
    now >= m.outCheckin && now < m.outArr ? trip.out : trip.back && m.backCheckin !== null && now >= m.backCheckin ? trip.back : null;
  const flight = it?.segments.find((s) => toMs(s.dep) > now);
  if (!it || !flight) return [];
  const route = [first(it).from, ...it.segments.map((s) => s.to)].join(" – ");
  const seats = seatsOn(booking, flight);
  const boards = wallClock(toMs(flight.dep) - BOARDING, offsetOf(flight.from)).clock;
  const gate = known(events, "gate", now).find(
    (e) => e.flightNo === flight.flightNo && e.date === dateOf(flight.delay?.scheduledDep ?? flight.dep),
  );
  return booking.travellers.map((id) => ({
    travellerId: id,
    label: labelOf(profile, id),
    flightNo: flight.flightNo,
    route,
    seat: seats[id],
    boards,
    gate: gate?.gate ?? null,
    delay: flight.delay ? `Delayed ${formatDuration(flight.delay.minutes)} · ${flight.delay.reason}` : null,
    note: booking.assistance[id] === "wheelchair" ? "Wheelchair meets you at the curb" : null,
  }));
}

// ── Words ────────────────────────────────────────────────────────────────────

/** What a person would have said to cause an action. Used by the lab to caption clicks. */
export function describeAction(action: TripAction, state: TripState, profile: Profile, events: AirlineEvent[] = DEMO_EVENTS): string {
  switch (action.type) {
    case "understood":
      return "Enter";
    case "refine": {
      const p = action.patch;
      if (p.depart) return `leave ${dayLabel(p.depart).toLowerCase()} instead`;
      if (p.avoidOvernight === false) return "overnight layovers are fine";
      if (p.avoidOvernight === true) return "no overnight layovers";
      if (p.priority) return p.priority === "balanced" ? "balance price and time" : `${p.priority} first`;
      return "change that";
    }
    case "select": {
      if (!action.optionId || !state.request) return "back to the options";
      const option = results(state.request).options.find((o) => o.id === action.optionId);
      return option ? `the ${option.tag.toLowerCase()} one` : "that one";
    }
    case "seat_pref": {
      const who = labelOf(profile, action.travellerId);
      return `${action.pref} for ${who === "You" ? "me" : who.toLowerCase()}`;
    }
    case "book":
      return "Enter";
    case "rebook": {
      const event = eventById(events, action.eventId);
      const disruption = state.booking && event ? disruptionFor(state.booking, event, toMs(action.at), events) : null;
      const fix = disruption?.fixes.find((f) => f.segment.flightNo === action.flightNo);
      return fix ? `take the ${clockOf(fix.segment.dep)} one` : "switch";
    }
    case "refare":
      return "take the lower fare";
  }
}

/** "You and Mom" for a booking or request. */
export const travellersLabel = (ids: string[], profile: Profile) => joinLabels(ids.map((id) => labelOf(profile, id)));
