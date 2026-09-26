import { formatAmount } from "@/lib/parse/common";
import { type AirportCode, cityOf, offsetOf } from "./airports";
import { DEMO_EVENTS, eventOfKind } from "./events";
import { results } from "./rank";
import { disruptionFor, initialTrip, milestones, reduceTrip, type TripState } from "./trip";
import { clockOf, dayLabel, formatDuration, MINUTE, toMs, wallClock } from "./time";
import type { TripRequest } from "./types";

/**
 * The demo beats, built by running the real reducer over a script. They are the contract for the UI
 * (the lab renders them) and for the parsers (beat one's draft is what `say` must produce from the
 * sentence). Twelve moments from one sentence to back home, through a fare watched, a cancellation,
 * and a fog delay that breaks a connection.
 */

export type BeatLine = { kind: "say" | "event" | "enter"; text: string };

export type Beat = {
  id: string;
  label: string;
  /** What the person said, or what happened in the world, just before this moment. */
  line: BeatLine;
  state: TripState;
  /** A live, uncommitted reading of the text box. Only the first beat has one. */
  draft: TripRequest | null;
  now: number;
};

export const HERO_SENTENCE = "kathmandu from bangalore oct 10, back oct 25, me and mom, she needs a wheelchair, no overnight layovers";

export const HERO_REQUEST: TripRequest = {
  origin: "BLR",
  destination: "KTM",
  depart: "2026-10-10",
  back: "2026-10-25",
  travellers: ["me", "mom"],
  assistance: { mom: "wheelchair" },
  avoidOvernight: true,
  priority: "balanced",
};

const PLANNING = "2026-09-24T10:15:00+05:30";
/** The demo's "today": every clock in the job starts here, so the scripted events line up with the dates people type. */
export const DEMO_NOW = toMs(PLANNING);
const BOOKED_AT = "2026-09-24T10:17:00+05:30";
const REBOOKED_AT = "2026-10-10T05:04:00+05:30";
const REBOOKED_BACK_AT = "2026-10-25T09:43:00+05:45";

function eventLine(ms: number, text: string, at: AirportCode = "BLR"): BeatLine {
  const w = wallClock(ms, offsetOf(at));
  return { kind: "event", text: `${dayLabel(w.date)} · ${w.clock} · ${text}` };
}

const need = <T>(value: T | null | undefined, what: string): T => {
  if (value == null) throw new Error(`demo script: ${what}`);
  return value;
};

function buildBeats(): Beat[] {
  const planning = toMs(PLANNING);
  const understood = reduceTrip(initialTrip, { type: "understood", request: HERO_REQUEST });
  const found = results(HERO_REQUEST);
  const chosen = reduceTrip(reduceTrip(understood, { type: "select", optionId: found.options[0]?.id ?? null }), {
    type: "seat_pref",
    travellerId: "mom",
    pref: "aisle",
  });
  const booked = reduceTrip(chosen, { type: "book", at: BOOKED_AT });
  const booking = need(booked.booking, "booking failed");

  const fareDrop = need(eventOfKind(DEMO_EVENTS, "fare-o1-2026-10-01", "fare_drop"), "no fare drop");
  const dropped = booking.trip.out.farePerPerson - fareDrop.farePerPerson;

  const cancellation = need(eventOfKind(DEMO_EVENTS, "cancel-6E1159-2026-10-10", "cancelled"), "no cancellation");
  const fix = need(disruptionFor(booking, cancellation, toMs(cancellation.at))?.fixes[0], "no fix for the cancellation");
  const rebooked = reduceTrip(booked, { type: "rebook", eventId: cancellation.id, flightNo: fix.segment.flightNo, at: REBOOKED_AT });
  const outbound = need(rebooked.booking, "rebooking failed");
  const afterOut = milestones(outbound, toMs(REBOOKED_AT) + MINUTE);

  const fog = need(eventOfKind(DEMO_EVENTS, "fog-6E1160-2026-10-25", "delayed"), "no fog");
  const fogAt = toMs(fog.at);
  const missed = need(disruptionFor(outbound, fog, fogAt), "fog broke nothing");
  const fixBack = need(missed.fixes[0], "no fix for the missed connection");
  const fixed = reduceTrip(rebooked, { type: "rebook", eventId: fog.id, flightNo: fixBack.segment.flightNo, at: REBOOKED_BACK_AT });
  const home = need(milestones(need(fixed.booking, "return rebooking failed"), toMs(REBOOKED_BACK_AT) + MINUTE).backArr, "no return");
  const late = formatDuration(missed.cause?.segment.delay?.minutes ?? 0);

  return [
    { id: "say", label: "Say it", line: { kind: "say", text: HERO_SENTENCE }, state: initialTrip, draft: HERO_REQUEST, now: planning },
    { id: "choose", label: "Choose", line: { kind: "enter", text: "Enter" }, state: understood, draft: null, now: planning + MINUTE },
    {
      id: "confirm",
      label: "Confirm",
      line: { kind: "say", text: "the first one, aisle for mom" },
      state: chosen,
      draft: null,
      now: planning + 2 * MINUTE,
    },
    { id: "booked", label: "Booked", line: { kind: "enter", text: "Enter" }, state: booked, draft: null, now: toMs(BOOKED_AT) + MINUTE },
    {
      id: "fare",
      label: "Watched",
      line: eventLine(toMs(fareDrop.at), `IndiGo fare dropped ${formatAmount(dropped)} per person`),
      state: booked,
      draft: null,
      now: toMs(fareDrop.at) + MINUTE,
    },
    {
      id: "checkin",
      label: "Check-in",
      line: eventLine(afterOut.outCheckin, "check-in opened"),
      state: booked,
      draft: null,
      now: afterOut.outCheckin + 5 * MINUTE,
    },
    {
      id: "cancelled",
      label: "Cancelled",
      line: eventLine(toMs(cancellation.at), `${cancellation.flightNo} to ${cityOf("KTM")} cancelled`),
      state: booked,
      draft: null,
      now: toMs(cancellation.at) + MINUTE,
    },
    {
      id: "rebooked",
      label: "Rebooked",
      line: { kind: "say", text: `take the ${clockOf(fix.segment.dep)} one` },
      state: rebooked,
      draft: null,
      now: toMs(REBOOKED_AT) + MINUTE,
    },
    {
      id: "landed",
      label: "Landed",
      line: eventLine(afterOut.outArr, `landed in ${cityOf("KTM")}`, "KTM"),
      state: rebooked,
      draft: null,
      now: afterOut.outArr + 10 * MINUTE,
    },
    {
      id: "fog",
      label: "Fog",
      line: eventLine(fogAt, `${fog.flightNo} delayed ${late}, ${fog.reason}`, "KTM"),
      state: rebooked,
      draft: null,
      now: fogAt + MINUTE,
    },
    {
      id: "fixed",
      label: "Fixed",
      line: { kind: "say", text: `take the ${clockOf(fixBack.segment.dep)} one` },
      state: fixed,
      draft: null,
      now: toMs(REBOOKED_BACK_AT) + MINUTE,
    },
    { id: "home", label: "Home", line: eventLine(home, "home"), state: fixed, draft: null, now: home + 10 * MINUTE },
  ];
}

export const BEATS: Beat[] = buildBeats();

export const beatById = (id: string): Beat =>
  need(
    BEATS.find((b) => b.id === id),
    `no beat ${id}`,
  );
