import { type AirportCode, cityOf, offsetOf } from "./airports";
import { addDays, clockOf, dateOf, formatDuration, isoAt, minutesBetween, toMs } from "./time";
import type { Itinerary, Segment, Ticketing, Trip, TripRequest } from "./types";

/**
 * Preflight checks: everything a careful travel agent would warn you about, found before you choose.
 * Deterministic rules over structured flights. Jev never judges these; it only reads what you asked for.
 */

export type FlagLevel = "ok" | "warn" | "block";
export type FlagKind =
  | "one_ticket"
  | "easy_connection"
  | "wheelchair_ok"
  | "all_kept"
  | "documents"
  | "tight_connection"
  | "self_transfer"
  | "recheck_bags"
  | "late_arrival"
  | "overnight"
  | "no_wheelchair"
  | "too_short";
export type Flag = { kind: FlagKind; level: FlagLevel; text: string };

/** Connection minimums in minutes. Below `hard` a connection is never offered. */
export const CONNECTION = { comfortable: 60, withWheelchair: 120, hard: 45 } as const;

type Needs = Pick<TripRequest, "assistance" | "avoidOvernight">;

export const needsWheelchair = (needs: Pick<TripRequest, "assistance">) => Object.values(needs.assistance).includes("wheelchair");

/** True when a wait covers any part of 00:00–05:00 on the local clock. */
export function spansNight(from: string, until: string, offset: string): boolean {
  const start = toMs(from);
  const end = toMs(until);
  for (let d = dateOf(from); d <= dateOf(until); d = addDays(d, 1)) {
    if (toMs(isoAt(d, "00:00", offset)) < end && toMs(isoAt(d, "05:00", offset)) > start) return true;
  }
  return false;
}

/** Landing at 23:00 or later, or before 05:00, on the local clock. */
export function isLate(iso: string): boolean {
  const clock = clockOf(iso);
  return clock >= "23:00" || clock < "05:00";
}

export type Layover = { at: AirportCode; arr: string; dep: string; minutes: number; overnight: boolean };

export function layoversOf(segments: Segment[]): Layover[] {
  return segments.slice(1).map((next, i) => {
    const prev = segments[i];
    return {
      at: prev.to,
      arr: prev.arr,
      dep: next.dep,
      minutes: minutesBetween(prev.arr, next.dep),
      overnight: spansNight(prev.arr, next.dep, offsetOf(prev.to)),
    };
  });
}

/** Door-to-door minutes for one direction. */
export const durationOf = (segments: Segment[]) => minutesBetween(segments[0].dep, segments[segments.length - 1].arr);

function connectionFlags(layover: Layover, ticketing: Ticketing, needs: Needs): Flag[] {
  const city = cityOf(layover.at);
  const wait = formatDuration(layover.minutes);
  const wheelchair = needsWheelchair(needs);
  const flags: Flag[] = [];
  if (layover.overnight) {
    flags.push({ kind: "overnight", level: needs.avoidOvernight ? "block" : "warn", text: `Overnight layover in ${city}` });
  }
  if (layover.minutes < CONNECTION.hard) {
    flags.push({ kind: "too_short", level: "block", text: `${wait} connection in ${city}` });
  }
  if (ticketing === "separate") {
    flags.push({ kind: "self_transfer", level: "warn", text: `Self-transfer in ${city}, ${wait}` });
    flags.push({ kind: "recheck_bags", level: "warn", text: `Re-check bags in ${city}` });
  } else if (!layover.overnight) {
    const minimum = wheelchair ? CONNECTION.withWheelchair : CONNECTION.comfortable;
    flags.push(
      layover.minutes < minimum
        ? { kind: "tight_connection", level: "warn", text: `${wait} connection, tight${wheelchair ? " with a wheelchair" : ""}` }
        : { kind: "easy_connection", level: "ok", text: `${wait} connection` },
    );
  }
  return flags;
}

const LEVEL_ORDER: Record<FlagLevel, number> = { block: 0, warn: 1, ok: 2 };
export const sortFlags = (flags: Flag[]) => [...flags].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);

/** Flags for one direction of travel. */
export function checkItinerary(it: Itinerary, needs: Needs): Flag[] {
  const wheelchair = needsWheelchair(needs);
  const flags: Flag[] = [];
  const unsupported = it.segments.find((s) => !s.wheelchair);
  if (wheelchair && unsupported) {
    flags.push({ kind: "no_wheelchair", level: "block", text: `No wheelchair service on ${unsupported.flightNo}` });
  }
  for (const layover of layoversOf(it.segments)) flags.push(...connectionFlags(layover, it.ticketing, needs));
  const landing = it.segments[it.segments.length - 1].arr;
  if (isLate(landing)) flags.push({ kind: "late_arrival", level: "warn", text: `Lands ${clockOf(landing)}` });
  if (it.ticketing === "single") flags.push({ kind: "one_ticket", level: "ok", text: "One ticket, bags go through" });
  if (wheelchair && !unsupported) flags.push({ kind: "wheelchair_ok", level: "ok", text: "Wheelchair on every flight" });
  return sortFlags(flags);
}

/** Good news worded for both directions when the per-leg texts differ. */
const OK_BOTH_WAYS: Partial<Record<FlagKind, string>> = { easy_connection: "Easy connections both ways" };

/**
 * Flags for a whole trip. Problems say which way they happen. Good news only counts when it is true in
 * both directions.
 */
export function checkTrip(trip: Trip, needs: Needs): Flag[] {
  const out = checkItinerary(trip.out, needs);
  if (!trip.back) return out;
  const back = checkItinerary(trip.back, needs);
  const merged: Flag[] = [];
  for (const kind of new Set([...out, ...back].map((f) => f.kind))) {
    const o = out.find((f) => f.kind === kind);
    const b = back.find((f) => f.kind === kind);
    if (o?.level === "ok" || b?.level === "ok") {
      if (o && b) merged.push(o.text === b.text ? o : { ...o, text: OK_BOTH_WAYS[kind] ?? o.text });
      continue;
    }
    if (o && b && o.text === b.text) {
      merged.push({ ...o, level: LEVEL_ORDER[o.level] <= LEVEL_ORDER[b.level] ? o.level : b.level, text: `${o.text} · both ways` });
      continue;
    }
    if (o) merged.push({ ...o, text: `${o.text} · on the way out` });
    if (b) merged.push({ ...b, text: `${b.text} · on the way back` });
  }
  return sortFlags(merged);
}
