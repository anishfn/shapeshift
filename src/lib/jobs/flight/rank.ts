import type { AirportCode } from "./airports";
import { checkTrip, durationOf, type Flag, type FlagKind } from "./checks";
import { airlinesOn, searchItineraries } from "./inventory";
import { addDays, dayLabel } from "./time";
import type { Priority, Trip, TripRequest } from "./types";

/**
 * Turns every candidate trip into three distinct choices. Show the decision space, not a list of
 * hundreds: the cheapest, the fastest, and the best balance of price, time and risk.
 */

export type OptionTag = "Best balance" | "Cheapest" | "Fastest";

export type Option = { id: string; tag: OptionTag; trip: Trip; total: number; minutes: number; flags: Flag[] };

export type DayPrice = { date: string; total: number | null };

export type Results = {
  options: Option[];
  /** Trips on the chosen day that pass every hard rule. */
  valid: number;
  /** Trips hidden on the chosen day, grouped by the rule they broke. */
  hidden: { kind: FlagKind; label: string; count: number }[];
  /** Best-balance total for each departure day around the chosen one. */
  strip: DayPrice[];
  /** How wide the search went, so nobody feels the need to double-check elsewhere. */
  proof: { trips: number; airlines: number; days: number };
};

export const WINDOW_DAYS = 3;

const WEIGHTS: Record<Priority, { price: number; time: number }> = {
  balanced: { price: 0.5, time: 0.3 },
  cheapest: { price: 0.85, time: 0.1 },
  fastest: { price: 0.2, time: 0.75 },
};

/** Each warning costs about a third of the price range: risk is a real cost, not a footnote. */
const WARNING_COST = 0.35;

const HIDDEN_LABEL: Partial<Record<FlagKind, string>> = {
  overnight: "overnight layovers",
  no_wheelchair: "no wheelchair service",
  too_short: "connections too short to make",
};

type Searchable = TripRequest & { origin: AirportCode; destination: AirportCode; depart: string };

export const isSearchable = (req: TripRequest): req is Searchable =>
  Boolean(req.origin && req.destination && req.depart && req.travellers.length);

type Scored = { trip: Trip; total: number; minutes: number; flags: Flag[] };

function tripsOn(req: Searchable, depart: string): Trip[] {
  const outs = searchItineraries(req.origin, req.destination, depart);
  if (!req.back) return outs.map((out) => ({ id: out.id, out, back: null }));
  if (req.back <= depart) return [];
  const backs = searchItineraries(req.destination, req.origin, req.back);
  return outs.flatMap((out) => backs.map((back) => ({ id: `${out.id}+${back.id}`, out, back })));
}

function scoreAll(trips: Trip[], req: Searchable): Scored[] {
  const people = req.travellers.length;
  return trips.map((trip) => ({
    trip,
    total: (trip.out.farePerPerson + (trip.back?.farePerPerson ?? 0)) * people,
    minutes: durationOf(trip.out.segments) + (trip.back ? durationOf(trip.back.segments) : 0),
    flags: checkTrip(trip, req),
  }));
}

const warnings = (s: Scored) => s.flags.filter((f) => f.level === "warn").length;
const isBlocked = (s: Scored) => s.flags.some((f) => f.level === "block");
const minBy = <T>(items: T[], key: (item: T) => number) => items.reduce((best, item) => (key(item) < key(best) ? item : best));

function balance(valid: Scored[], priority: Priority) {
  const prices = valid.map((s) => s.total);
  const times = valid.map((s) => s.minutes);
  const [pLo, pHi, tLo, tHi] = [Math.min(...prices), Math.max(...prices), Math.min(...times), Math.max(...times)];
  const norm = (v: number, lo: number, hi: number) => (hi === lo ? 0 : (v - lo) / (hi - lo));
  const w = WEIGHTS[priority];
  return (s: Scored) => w.price * norm(s.total, pLo, pHi) + w.time * norm(s.minutes, tLo, tHi) + WARNING_COST * warnings(s);
}

type Day = { options: Option[]; valid: Scored[]; blocked: Scored[]; count: number };

function rankDay(req: Searchable, depart: string): Day {
  const scored = scoreAll(tripsOn(req, depart), req);
  const valid = scored.filter((s) => !isBlocked(s));
  const blocked = scored.filter(isBlocked);
  if (!valid.length) return { options: [], valid, blocked, count: scored.length };
  const picks: [OptionTag, Scored][] = [
    ["Best balance", minBy(valid, balance(valid, req.priority))],
    ["Cheapest", minBy(valid, (s) => s.total + s.minutes / 1e4)],
    ["Fastest", minBy(valid, (s) => s.minutes + s.total / 1e7)],
  ];
  const options: Option[] = [];
  for (const [tag, s] of picks) {
    if (!options.some((o) => o.id === s.trip.id)) options.push({ id: s.trip.id, tag, ...s });
  }
  return { options, valid, blocked, count: scored.length };
}

const EMPTY: Results = { options: [], valid: 0, hidden: [], strip: [], proof: { trips: 0, airlines: 0, days: 0 } };

export function results(req: TripRequest): Results {
  if (!isSearchable(req)) return EMPTY;
  const day = rankDay(req, req.depart);

  const hidden = new Map<FlagKind, number>();
  for (const s of day.blocked) {
    const rule = s.flags.find((f) => f.level === "block");
    if (rule) hidden.set(rule.kind, (hidden.get(rule.kind) ?? 0) + 1);
  }

  const strip: DayPrice[] = [];
  let trips = 0;
  for (let offset = -WINDOW_DAYS; offset <= WINDOW_DAYS; offset++) {
    const date = addDays(req.depart, offset);
    const ranked = offset === 0 ? day : rankDay(req, date);
    trips += ranked.count;
    strip.push({ date, total: ranked.options[0]?.total ?? null });
  }

  const airlines = new Set([...airlinesOn(req.origin, req.destination), ...(req.back ? airlinesOn(req.destination, req.origin) : [])]);

  return {
    options: day.options,
    valid: day.valid.length,
    hidden: [...hidden].map(([kind, count]) => ({ kind, label: HIDDEN_LABEL[kind] ?? kind, count })),
    strip,
    proof: { trips, airlines: airlines.size, days: 2 * WINDOW_DAYS + 1 },
  };
}

/** "Checked 175 trips · 3 airlines · 7 days · hid 9 with overnight layovers" */
export function proofLine(r: Results): string {
  if (!r.proof.trips) return "No demo fares for this route yet";
  return [
    `Checked ${r.proof.trips} trips`,
    `${r.proof.airlines} airlines`,
    `${r.proof.days} days`,
    ...r.hidden.map((h) => `hid ${h.count} with ${h.label}`),
  ].join(" · ");
}

/** The cheapest nearby departure day, when it beats the chosen one. */
export function cheaperDay(r: Results, depart: string): { date: string; label: string; saving: number } | null {
  const current = r.strip.find((d) => d.date === depart)?.total;
  const priced = r.strip.filter((d): d is { date: string; total: number } => d.total !== null);
  if (current == null || !priced.length) return null;
  const best = minBy(priced, (d) => d.total);
  if (best.date === depart || best.total >= current) return null;
  return { date: best.date, label: dayLabel(best.date), saving: current - best.total };
}
