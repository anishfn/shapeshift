import { describe, expect, test } from "bun:test";
import { BEATS, HERO_REQUEST } from "@/lib/jobs/flight/beats";
import { checkItinerary, checkTrip, isLate, layoversOf, spansNight } from "@/lib/jobs/flight/checks";
import { DEMO_EVENTS, eventOfKind } from "@/lib/jobs/flight/events";
import { fareOn, hasInventory, searchFlights, searchItineraries } from "@/lib/jobs/flight/inventory";
import { DEMO_PROFILE, joinLabels } from "@/lib/jobs/flight/profile";
import { cheaperDay, proofLine, results } from "@/lib/jobs/flight/rank";
import { addDays, dayLabel, formatDuration, minutesBetween, toMs, wallClock } from "@/lib/jobs/flight/time";
import {
  currentTrip,
  describeAction,
  disruptionAt,
  disruptionFor,
  initialTrip,
  milestones,
  momentsOf,
  passesAt,
  phaseOf,
  pnrOf,
  reduceTrip,
  seatsOn,
  stageOf,
  type TripState,
} from "@/lib/jobs/flight/trip";
import type { TripRequest } from "@/lib/jobs/flight/types";

const HOUR = 3_600_000;
const out = (key: string, date = "2026-10-10") => searchItineraries("BLR", "KTM", date).find((it) => it.id === `${key}@${date}`)!;
const CANCEL = eventOfKind(DEMO_EVENTS, "cancel-6E1159-2026-10-10", "cancelled")!;
const BOOKED_AT = "2026-09-24T10:17:00+05:30";

function bookedHero(): TripState {
  const understood = reduceTrip(initialTrip, { type: "understood", request: HERO_REQUEST });
  const best = results(HERO_REQUEST).options[0];
  const chosen = reduceTrip(reduceTrip(understood, { type: "select", optionId: best.id }), {
    type: "seat_pref",
    travellerId: "mom",
    pref: "aisle",
  });
  return reduceTrip(chosen, { type: "book", at: BOOKED_AT });
}

describe("time", () => {
  test("durations cross time zones", () => {
    // 06:40 in Bengaluru to 13:35 in Kathmandu is 6h 40m, not 6h 55m.
    expect(minutesBetween("2026-10-10T06:40:00+05:30", "2026-10-10T13:35:00+05:45")).toBe(400);
    expect(formatDuration(400)).toBe("6h 40m");
    expect(formatDuration(45)).toBe("45m");
    expect(formatDuration(120)).toBe("2h");
  });
  test("calendar labels and math", () => {
    expect(dayLabel("2026-10-10")).toBe("Sat, Oct 10");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(wallClock(Date.parse("2026-10-10T05:02:00+05:30"), "+05:45")).toEqual({ date: "2026-10-10", clock: "05:17" });
  });
});

describe("inventory", () => {
  test("is deterministic and only covers the demo route", () => {
    expect(searchItineraries("BLR", "KTM", "2026-10-10")).toEqual(searchItineraries("BLR", "KTM", "2026-10-10"));
    expect(searchItineraries("BLR", "KTM", "2026-10-10")).toHaveLength(5);
    expect(hasInventory("BLR", "KTM")).toBe(true);
    expect(searchItineraries("BLR", "CCU", "2026-10-10")).toEqual([]);
  });
  test("fares move with the weekday", () => {
    expect(fareOn(10450, "2026-10-10")).toBe(10450); // Saturday
    expect(fareOn(10450, "2026-10-08")).toBe(7650); // Thursday deal
    expect(fareOn(10450, "2026-10-09")).toBe(13400); // Friday peak
  });
  test("overnight legs land on the next day", () => {
    const o4 = out("o4");
    expect(o4.segments[1].dep).toBe("2026-10-11T09:45:00+05:30");
  });
  test("single flights include spares, sorted by departure, each with a walk-up fare", () => {
    const flights = searchFlights("DEL", "KTM", "2026-10-10");
    expect(flights.map((f) => f.flightNo)).toEqual(["RA 216", "AI 215", "6E 1159", "RA 218", "AI 217"]);
    expect(flights.every((f) => f.fare > 0)).toBe(true);
    expect(searchFlights("DEL", "BLR", "2026-10-25").map((f) => f.flightNo)).toEqual([
      "6E 2136",
      "6E 2006",
      "AI 504",
      "6E 2132",
      "6E 2138",
      "6E 2134",
      "AI 506",
    ]);
  });
  test("itineraries carry their fees", () => {
    expect(out("o1")).toMatchObject({ changeFee: 2500, refundFee: null });
    expect(out("o3")).toMatchObject({ changeFee: 3000, refundFee: 3500 });
  });
});

describe("checks", () => {
  test("night and late detection", () => {
    expect(spansNight("2026-10-10T22:05:00+05:30", "2026-10-11T09:45:00+05:30", "+05:30")).toBe(true);
    expect(spansNight("2026-10-10T09:25:00+05:30", "2026-10-10T11:35:00+05:30", "+05:30")).toBe(false);
    expect(isLate("2026-10-10T23:25:00+05:45")).toBe(true);
    expect(isLate("2026-10-10T13:35:00+05:45")).toBe(false);
    expect(layoversOf(out("o1").segments)[0].minutes).toBe(130);
  });
  test("one ticket with an easy connection has nothing to warn about", () => {
    const flags = checkItinerary(out("o1"), HERO_REQUEST);
    expect(flags.every((f) => f.level === "ok")).toBe(true);
    expect(flags.map((f) => f.text)).toContain("One ticket, bags go through");
  });
  test("separate tickets warn about self-transfer and bags", () => {
    const texts = checkItinerary(out("o2"), HERO_REQUEST).map((f) => f.text);
    expect(texts).toContain("Self-transfer in Delhi, 1h 35m");
    expect(texts).toContain("Re-check bags in Delhi");
  });
  test("a short connection is tight only because of the wheelchair", () => {
    expect(checkItinerary(out("o3"), HERO_REQUEST).find((f) => f.kind === "tight_connection")?.text).toBe(
      "1h 10m connection, tight with a wheelchair",
    );
    expect(checkItinerary(out("o3"), { ...HERO_REQUEST, assistance: {} }).some((f) => f.kind === "tight_connection")).toBe(false);
  });
  test("overnight layovers block when the traveller said no, and warn otherwise", () => {
    expect(checkItinerary(out("o4"), HERO_REQUEST).find((f) => f.kind === "overnight")?.level).toBe("block");
    expect(checkItinerary(out("o4"), { ...HERO_REQUEST, avoidOvernight: false }).find((f) => f.kind === "overnight")?.level).toBe("warn");
  });
  test("round trips say which way a problem happens", () => {
    const back = searchItineraries("KTM", "BLR", "2026-10-25");
    const texts = checkTrip({ id: "x", out: out("o5"), back: back[4] }, HERO_REQUEST).map((f) => f.text);
    expect(texts).toContain("Lands 23:25 · on the way out");
    expect(texts).toContain("Lands 01:50 · on the way back");
    const same = checkTrip({ id: "y", out: out("o2"), back: back[1] }, HERO_REQUEST).map((f) => f.text);
    expect(same).toContain("Self-transfer in Delhi, 1h 35m · both ways");
  });
});

describe("ranking", () => {
  const r = results(HERO_REQUEST);
  test("three distinct options for the hero trip", () => {
    expect(r.options.map((o) => [o.tag, o.id, o.total])).toEqual([
      ["Best balance", "o1@2026-10-10+b1@2026-10-25", 41800],
      ["Cheapest", "o2@2026-10-10+b2@2026-10-25", 34600],
      ["Fastest", "o3@2026-10-10+b3@2026-10-25", 52400],
    ]);
  });
  test("the proof line says how wide the search went and what it hid", () => {
    expect(proofLine(r)).toBe("Checked 175 trips · 3 airlines · 7 days · hid 9 with overnight layovers");
    expect(r.valid).toBe(16);
  });
  test("the date strip finds a cheaper day", () => {
    expect(r.strip.map((d) => d.date)).toEqual([
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
      "2026-10-10",
      "2026-10-11",
      "2026-10-12",
      "2026-10-13",
    ]);
    expect(cheaperDay(r, "2026-10-10")).toEqual({ date: "2026-10-08", label: "Thu, Oct 8", saving: 5600 });
  });
  test("allowing overnight layovers unlocks the cheapest fares", () => {
    const loose = results({ ...HERO_REQUEST, avoidOvernight: false });
    expect(loose.options.find((o) => o.tag === "Cheapest")?.total).toBe(31600);
    expect(loose.hidden).toEqual([]);
  });
  test("an incomplete or unknown request returns nothing", () => {
    expect(results({ ...HERO_REQUEST, depart: null }).options).toEqual([]);
    expect(results({ ...HERO_REQUEST, destination: "CCU" }).options).toEqual([]);
    expect(proofLine(results({ ...HERO_REQUEST, destination: "CCU" }))).toBe("No demo fares for this route yet");
  });
  test("one-way trips work", () => {
    const oneWay = results({ ...HERO_REQUEST, back: null });
    expect(oneWay.options[0]?.trip.back).toBeNull();
    expect(oneWay.options[0]?.total).toBe(20900);
  });
});

describe("reducer and stages", () => {
  test("the stage follows the state", () => {
    expect(stageOf(initialTrip)).toBe("understand");
    const understood = reduceTrip(initialTrip, { type: "understood", request: HERO_REQUEST });
    expect(stageOf(understood)).toBe("choose");
    const best = results(HERO_REQUEST).options[0];
    const chosen = reduceTrip(understood, { type: "select", optionId: best.id });
    expect(stageOf(chosen)).toBe("confirm");
    expect(stageOf(reduceTrip(chosen, { type: "book", at: BOOKED_AT }))).toBe("trip");
  });
  test("changing the date drops a choice that no longer exists", () => {
    const understood = reduceTrip(initialTrip, { type: "understood", request: HERO_REQUEST });
    const chosen = reduceTrip(understood, { type: "select", optionId: results(HERO_REQUEST).options[0].id });
    const moved = reduceTrip(chosen, { type: "refine", patch: { depart: "2026-10-08" } });
    expect(moved.selectedId).toBeNull();
    expect(stageOf(moved)).toBe("choose");
    // A change that keeps the option keeps the choice.
    expect(reduceTrip(chosen, { type: "refine", patch: { priority: "balanced" } }).selectedId).toBe(chosen.selectedId);
  });
  test("guards: no booking without a choice, no selecting what isn't offered, nothing changes after booking", () => {
    const understood = reduceTrip(initialTrip, { type: "understood", request: HERO_REQUEST });
    expect(reduceTrip(understood, { type: "book", at: BOOKED_AT }).booking).toBeNull();
    expect(reduceTrip(understood, { type: "select", optionId: "nope" })).toBe(understood);
    const booked = bookedHero();
    expect(reduceTrip(booked, { type: "refine", patch: { depart: "2026-10-08" } })).toBe(booked);
    expect(reduceTrip(booked, { type: "book", at: "2026-09-24T10:18:00+05:30" })).toBe(booked);
  });
  test("bookings get a stable reference", () => {
    expect(pnrOf("abc")).toBe(pnrOf("abc"));
    expect(pnrOf("abc")).toMatch(/^[A-Z0-9]{6}$/);
    expect(pnrOf("abc")).not.toBe(pnrOf("abd"));
  });
});

describe("the trip over time", () => {
  const booked = bookedHero().booking!;
  const m = milestones(booked, toMs(BOOKED_AT));

  test("phases follow the clock", () => {
    expect(phaseOf(booked, m.booked)).toBe("booked");
    expect(phaseOf(booked, m.outCheckin + 1)).toBe("checkin");
    expect(phaseOf(booked, m.outDep - HOUR)).toBe("flyout");
    expect(phaseOf(booked, m.outArr + HOUR)).toBe("away");
    expect(phaseOf(booked, m.backDep! - HOUR)).toBe("flyback");
    expect(phaseOf(booked, m.backArr! + HOUR)).toBe("home");
  });

  test("the person who needs help sits at the aisle with their companion beside them", () => {
    const seats = seatsOn(booked, booked.trip.out.segments[0]);
    expect(seats.mom).toMatch(/^\d+C$/);
    expect(seats.me).toBe(seats.mom.replace("C", "B"));
    const window = seatsOn({ ...booked, seatPrefs: { ...booked.seatPrefs, me: "window" } }, booked.trip.out.segments[0]);
    expect(window.me).toMatch(/A$/);
  });

  test("a cancellation surfaces fixes that keep the constraints first", () => {
    const cancelledAt = toMs(CANCEL.at);
    expect(disruptionAt(booked, cancelledAt - 1)).toBeNull();
    const d = disruptionAt(booked, cancelledAt + 1)!;
    expect(d.kind).toBe("cancelled");
    expect(d.protected).toBe(true);
    expect(d.segment.flightNo).toBe("6E 1159");
    expect(d.fixes.map((f) => f.segment.flightNo)).toEqual(["RA 218", "AI 215", "AI 217"]);
    expect(d.fixes[0].flags.every((f) => f.level === "ok")).toBe(true);
    expect(d.fixes.every((f) => f.costPerPerson === 0)).toBe(true);
    expect(d.fixes[2].flags.map((f) => f.text)).toContain("Lands 23:25");
  });

  test("rebooking swaps the flight, moves the landing and resolves the disruption", () => {
    const state: TripState = { ...bookedHero() };
    const later = toMs(CANCEL.at) + HOUR;
    const rebooked = reduceTrip(state, { type: "rebook", eventId: CANCEL.id, flightNo: "RA 218", at: "2026-10-10T05:04:00+05:30" });
    const b = rebooked.booking!;
    expect(currentTrip(b, later).out.segments.map((s) => s.flightNo)).toEqual(["6E 2131", "RA 218"]);
    expect(disruptionAt(b, later)).toBeNull();
    expect(momentsOf(b, later).find((x) => x.id === "landed-out")?.text).toBe("Land in Kathmandu Sat, Oct 10 at 16:10");
    // A fix that isn't on offer is ignored.
    expect(reduceTrip(state, { type: "rebook", eventId: CANCEL.id, flightNo: "6E 1159", at: "2026-10-10T05:04:00+05:30" })).toBe(state);
    // Scrubbing back before the decision shows the cancellation again, and the sold flight.
    expect(disruptionAt(b, toMs(CANCEL.at) + 60_000)?.segment.flightNo).toBe("6E 1159");
    expect(currentTrip(b, toMs(CANCEL.at) + 60_000).out.segments[1].flightNo).toBe("6E 1159");
  });

  test("the card never promises a landing time that a pending cancellation broke", () => {
    const now = toMs(CANCEL.at) + 60_000;
    expect(momentsOf(booked, now).find((x) => x.id === "landed-out")?.text).toBe("New landing time comes with the fix you pick");
  });

  test("check-in happens on its own and boarding passes appear with it", () => {
    expect(momentsOf(booked, m.outCheckin - 1).find((x) => x.id === "checkin-out")?.status).toBe("next");
    expect(momentsOf(booked, m.outCheckin + 1).find((x) => x.id === "checkin-out")?.text).toBe("Checked in for both of you");
    expect(passesAt(booked, m.outCheckin - 1, DEMO_PROFILE)).toEqual([]);
    const passes = passesAt(booked, m.outCheckin + 1, DEMO_PROFILE);
    expect(passes.map((p) => p.label)).toEqual(["You", "Mom"]);
    expect(passes[1].note).toBe("Wheelchair meets you at the curb");
    expect(passes[0].boards).toBe("06:00");
    expect(passes[0].gate).toBeNull();
  });
});

describe("demo beats", () => {
  test("twelve beats walk the whole job", () => {
    expect(BEATS.map((b) => b.id)).toEqual([
      "say",
      "choose",
      "confirm",
      "booked",
      "fare",
      "checkin",
      "cancelled",
      "rebooked",
      "landed",
      "fog",
      "fixed",
      "home",
    ]);
    expect(BEATS.slice(0, 4).map((b) => stageOf(b.state))).toEqual(["understand", "choose", "confirm", "trip"]);
    expect(BEATS.slice(3).every((b) => stageOf(b.state) === "trip")).toBe(true);
    const phases = BEATS.slice(3).map((b) => phaseOf(b.state.booking!, b.now));
    expect(phases).toEqual(["booked", "booked", "checkin", "flyout", "flyout", "away", "away", "away", "home"]);
  });
  test("only the cancelled and fog beats need a decision", () => {
    expect(BEATS.slice(3).map((b) => disruptionAt(b.state.booking!, b.now) !== null)).toEqual([
      false,
      false,
      false,
      true,
      false,
      false,
      true,
      false,
      false,
    ]);
  });
  test("lines read like what happened", () => {
    expect(BEATS[4].line.text).toBe("Thu, Oct 1 · 09:00 · IndiGo fare dropped ₹1,200 per person");
    expect(BEATS[5].line.text).toBe("Thu, Oct 8 · 06:40 · check-in opened");
    expect(BEATS[6].line.text).toBe("Sat, Oct 10 · 05:02 · 6E 1159 to Kathmandu cancelled");
    expect(BEATS[7].line.text).toBe("take the 14:10 one");
    expect(BEATS[8].line.text).toBe("Sat, Oct 10 · 16:10 · landed in Kathmandu");
    expect(BEATS[9].line.text).toBe("Sun, Oct 25 · 09:40 · 6E 1160 delayed 2h, fog at Kathmandu");
    expect(BEATS[10].line.text).toBe("take the 20:05 one");
    expect(BEATS[11].line.text).toBe("Sun, Oct 25 · 22:50 · home");
  });
  test("clicks are captioned as sentences", () => {
    const understood = BEATS[1].state;
    const cheapest = results(understood.request as TripRequest).options[1];
    expect(describeAction({ type: "select", optionId: cheapest.id }, understood, DEMO_PROFILE)).toBe("the cheapest one");
    expect(describeAction({ type: "refine", patch: { depart: "2026-10-08" } }, understood, DEMO_PROFILE)).toBe("leave thu, oct 8 instead");
    expect(describeAction({ type: "seat_pref", travellerId: "me", pref: "window" }, understood, DEMO_PROFILE)).toBe("window for me");
    expect(joinLabels(["You", "Mom", "Dad"])).toBe("You, Mom and Dad");
  });
  test("every fix offered for the demo cancellation is bookable", () => {
    const booked = BEATS[3].state.booking!;
    for (const fix of disruptionFor(booked, CANCEL, toMs(CANCEL.at))!.fixes) {
      const next = reduceTrip(BEATS[3].state, { type: "rebook", eventId: CANCEL.id, flightNo: fix.segment.flightNo, at: CANCEL.at });
      expect(next.booking?.changes).toHaveLength(1);
    }
  });
});
