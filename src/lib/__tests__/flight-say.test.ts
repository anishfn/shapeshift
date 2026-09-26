import { describe, expect, test } from "bun:test";
import { AIRPORT_ALIASES, findAirport, findAirportsIn, isAirportCode } from "@/lib/jobs/flight/airports";
import { HERO_REQUEST, HERO_SENTENCE } from "@/lib/jobs/flight/beats";
import { DEMO_EVENTS, eventOfKind } from "@/lib/jobs/flight/events";
import { clockMatches, clocksIn, describeFollow, follow } from "@/lib/jobs/flight/follow";
import { judgeOffline, neutralJudgment, OFFLINE_QUESTION_COUNT, type TripJudgment, tripJudgmentSchema } from "@/lib/jobs/flight/judge";
import { DEMO_PROFILE, findTravellersIn, TRAVELLER_ALIASES } from "@/lib/jobs/flight/profile";
import { TRIP_QUESTION_COUNT } from "@/lib/jobs/flight/questions";
import { results } from "@/lib/jobs/flight/rank";
import { isTripSentence, say, sayCompleteness } from "@/lib/jobs/flight/say";
import { dateOf, toMs, weekdayOf } from "@/lib/jobs/flight/time";
import { disruptionAt, initialTrip, reduceTrip, stageOf, type TripAction, type TripState } from "@/lib/jobs/flight/trip";
import type { TripRequest } from "@/lib/jobs/flight/types";

// Thursday 24 Sep 2026, 10:15 local: the morning the hero sentence is typed.
const REF = new Date(2026, 8, 24, 10, 15);
const NOW = REF.getTime();
const MINUTE = 60_000;

/** Every deterministic guarantee must hold with the offline judge and with no judgment at all. */
const judgments = (text: string): [string, TripJudgment][] => [
  ["offline", judgeOffline(text)],
  ["neutral", neutralJudgment()],
];
const read = (text: string, judgment: TripJudgment = judgeOffline(text)) => say(text, judgment, DEMO_PROFILE, REF);
const sure = <T extends string>(value: T) => ({ value, confidence: 0.9, probabilities: { [value]: 0.9 } as Partial<Record<T, number>> });

function bookedHero(): TripState {
  const understood = reduceTrip(initialTrip, { type: "understood", request: HERO_REQUEST });
  const best = results(HERO_REQUEST).options[0];
  const chosen = reduceTrip(reduceTrip(understood, { type: "select", optionId: best.id }), {
    type: "seat_pref",
    travellerId: "mom",
    pref: "aisle",
  });
  return reduceTrip(chosen, { type: "book", at: "2026-09-24T10:17:00+05:30" });
}

describe("airports", () => {
  test("aliases resolve to codes, whatever the case or spelling", () => {
    expect(findAirport("Bangalore")).toBe("BLR");
    expect(findAirport("new delhi")).toBe("DEL");
    expect(findAirport("  Bombay ")).toBe("BOM");
    expect(findAirport("pkr")).toBe("PKR");
    expect(findAirport("paris")).toBeNull();
    expect(Object.values(AIRPORT_ALIASES).every(isAirportCode)).toBe(true);
  });
  test("cities are found as whole words, longest alias first, in text order", () => {
    expect(findAirportsIn("Fly BLR-KTM via New Delhi")).toEqual([
      { code: "BLR", index: 4, length: 3 },
      { code: "KTM", index: 8, length: 3 },
      { code: "DEL", index: 16, length: 9 },
    ]);
    expect(findAirportsIn("my goal is to travel")).toEqual([]);
    expect(findAirportsIn("delhi or new delhi").map((h) => h.length)).toEqual([5, 9]);
  });
});

describe("travellers", () => {
  test("the demo profile knows four people and dad has no ID yet", () => {
    expect(DEMO_PROFILE.travellers.map((t) => t.id)).toEqual(["me", "mom", "dad", "priya"]);
    expect(DEMO_PROFILE.travellers.find((t) => t.id === "dad")?.idOnFile).toBe(false);
    expect(TRAVELLER_ALIASES.me).toContain("i");
  });
  test("names are found in text order, once each, as whole words", () => {
    expect(findTravellersIn("Me and Mom, she needs a wheelchair")).toEqual(["me", "mom"]);
    expect(findTravellersIn("I'll take dad and priya")).toEqual(["me", "dad", "priya"]);
    expect(findTravellersIn("in italy with amma")).toEqual(["mom"]);
    expect(findTravellersIn("me, mom and me again")).toEqual(["me", "mom"]);
    expect(findTravellersIn("kathmandu oct 10")).toEqual([]);
  });
});

describe("the question set and its offline stand-in", () => {
  test("the offline judge answers exactly the questions Jev is asked", () => {
    expect(TRIP_QUESTION_COUNT).toBe(7);
    expect(OFFLINE_QUESTION_COUNT).toBe(TRIP_QUESTION_COUNT);
    expect(judgeOffline(HERO_SENTENCE).questionCount).toBe(TRIP_QUESTION_COUNT);
  });
  test("judgments survive the wire", () => {
    for (const j of [judgeOffline(HERO_SENTENCE), neutralJudgment(), neutralJudgment({ error: true, model: "error" })]) {
      expect(tripJudgmentSchema.safeParse(JSON.parse(JSON.stringify(j))).success).toBe(true);
    }
    expect(neutralJudgment().assistanceFor.value).toBe("nobody");
    expect(neutralJudgment().wantsFlight).toBe(0);
  });
  test("the hero sentence reads as a flight for two with help for the companion", () => {
    const j = judgeOffline(HERO_SENTENCE);
    expect(j.wantsFlight).toBeGreaterThanOrEqual(0.85);
    expect(j.party.value).toBe("self_and_others");
    expect(j.assistanceFor.value).toBe("companion");
    expect(j.avoidsOvernight).toBeGreaterThanOrEqual(0.85);
    expect(j.priority.value).toBe("balanced");
    expect(j.followUp.value).not.toBe("go_back");
    expect(j.source).toBe("mock");
    expect(j.model).toBe("jev-offline");
  });
  test("who is going and who needs help", () => {
    const self = judgeOffline("i need a wheelchair, bangalore to delhi oct 3");
    expect(self.party.value).toBe("self");
    expect(self.assistanceFor.value).toBe("self");
    const others = judgeOffline("mom and dad to kathmandu oct 10 for a week, dad needs a wheelchair");
    expect(others.party.value).toBe("others_only");
    expect(others.assistanceFor.value).toBe("companion");
    expect(judgeOffline("with mom to goa on the 12th").party.value).toBe("self_and_others");
    expect(judgeOffline("we both need wheelchairs, blr to ktm oct 10").assistanceFor.value).toBe("everyone");
    expect(judgeOffline("flight to goa next weekend").party.value).toBe("unspecified");
  });
  test("what matters", () => {
    expect(judgeOffline("delhi to kathmandu 12-15 oct cheapest").priority.value).toBe("cheapest");
    const fast = judgeOffline("just me, blr to ktm oct 10 fastest, no red-eye");
    expect(fast.priority.value).toBe("fastest");
    expect(fast.avoidsOvernight).toBeGreaterThanOrEqual(0.85);
    expect(judgeOffline("hello there").wantsFlight).toBeLessThan(0.5);
  });
  test("follow-ups are sorted by what they ask for", () => {
    const cases: [string, TripJudgment["followUp"]["value"], TripJudgment["optionPick"]["value"]][] = [
      ["the first one", "pick_option", "first"],
      ["the cheapest", "pick_option", "cheapest"],
      ["the best one", "pick_option", "balanced"],
      ["aisle for mom", "seat", "none"],
      ["take the 14:10 one", "take_fix", "none"],
      ["the 2pm one", "take_fix", "none"],
      ["book it", "book", "none"],
      ["back to options", "go_back", "none"],
      ["leave thursday instead", "change_day", "none"],
      ["allow overnight layovers", "relax_rule", "none"],
      ["hello there", "other", "none"],
    ];
    for (const [text, followUp, optionPick] of cases) {
      const j = judgeOffline(text);
      expect([text, j.followUp.value, j.optionPick.value]).toEqual([text, followUp, optionPick]);
      expect(j.followUp.confidence).toBe(followUp === "other" ? 0.74 : 0.86);
    }
  });
});

describe("say: one sentence to a request", () => {
  test("the hero sentence is read exactly, with or without a judgment", () => {
    for (const [, judgment] of judgments(HERO_SENTENCE)) expect(read(HERO_SENTENCE, judgment)).toEqual(HERO_REQUEST);
  });
  test("a weekend trip leaves from home on the coming Saturday", () => {
    const r = read("flight to goa next weekend");
    expect(r).toMatchObject({ origin: "BLR", destination: "GOI", depart: "2026-09-26", back: "2026-09-27", travellers: ["me"] });
    expect(weekdayOf(r.depart!)).toBe(6);
    // Without a judgment nobody is put on the trip; the rest still reads the same.
    expect(read("flight to goa next weekend", neutralJudgment())).toMatchObject({
      destination: "GOI",
      depart: "2026-09-26",
      travellers: [],
    });
  });
  test("a date range gives both days, and the priority word is read", () => {
    expect(read("delhi to kathmandu 12-15 oct cheapest")).toEqual({
      origin: "DEL",
      destination: "KTM",
      depart: "2026-10-12",
      back: "2026-10-15",
      travellers: ["me"],
      assistance: {},
      avoidOvernight: false,
      priority: "cheapest",
    });
  });
  test("named people without the writer travel alone, and a stay length sets the return", () => {
    const text = "mom and dad to kathmandu oct 10 for a week, dad needs a wheelchair";
    for (const [, judgment] of judgments(text)) {
      expect(read(text, judgment)).toEqual({
        origin: "BLR",
        destination: "KTM",
        depart: "2026-10-10",
        back: "2026-10-17",
        travellers: ["mom", "dad"],
        assistance: { dad: "wheelchair" },
        avoidOvernight: false,
        priority: "balanced",
      });
    }
    expect(read("goa oct 10 for 3 nights, wheelchair for me")).toMatchObject({ back: "2026-10-13", assistance: { me: "wheelchair" } });
  });
  test("one way stays one way", () => {
    expect(read("bangalore to mumbai tomorrow")).toMatchObject({ origin: "BLR", destination: "BOM", depart: "2026-09-25", back: null });
    expect(read("goa oct 10, back oct 5").back).toBeNull();
  });
  test("a bare city is a destination from home; the writer is on it only when the judgment reads a trip", () => {
    expect(read("kathmandu")).toEqual({
      origin: "BLR",
      destination: "KTM",
      depart: null,
      back: null,
      travellers: ["me"],
      assistance: {},
      avoidOvernight: false,
      priority: "balanced",
    });
    expect(read("kathmandu", neutralJudgment()).travellers).toEqual([]);
    // Home as the destination does not invent an origin.
    expect(read("bangalore")).toMatchObject({ origin: null, destination: "BLR" });
    expect(read("from bangalore")).toMatchObject({ origin: "BLR", destination: null, travellers: [] });
  });
  test("the writer's own wheelchair", () => {
    const text = "i need a wheelchair, bangalore to delhi oct 3";
    for (const [, judgment] of judgments(text)) {
      expect(read(text, judgment)).toMatchObject({
        origin: "BLR",
        destination: "DEL",
        depart: "2026-10-03",
        travellers: ["me"],
        assistance: { me: "wheelchair" },
      });
    }
  });
  test("fastest with no red-eye", () => {
    const text = "just me, blr to ktm oct 10 fastest, no red-eye";
    for (const [, judgment] of judgments(text)) {
      expect(read(text, judgment)).toMatchObject({
        origin: "BLR",
        destination: "KTM",
        depart: "2026-10-10",
        travellers: ["me"],
        priority: "fastest",
        avoidOvernight: true,
      });
    }
  });
  test("arrows, dashes and prepositions all place the cities", () => {
    expect(read("fly blr-ktm oct 10")).toMatchObject({ origin: "BLR", destination: "KTM" });
    expect(read("blr → ktm oct 10")).toMatchObject({ origin: "BLR", destination: "KTM" });
    expect(read("to bangalore from delhi oct 10 till oct 12")).toMatchObject({
      origin: "DEL",
      destination: "BLR",
      depart: "2026-10-10",
      back: "2026-10-12",
    });
    expect(read("bangalore to kathmandu via delhi oct 10")).toMatchObject({ origin: "BLR", destination: "KTM" });
  });
  test("with, for and needs-to say whether the writer is going", () => {
    for (const [, judgment] of judgments("with mom to goa on the 12th")) {
      expect(read("with mom to goa on the 12th", judgment)).toMatchObject({ depart: "2026-10-12", travellers: ["me", "mom"] });
    }
    expect(read("book for priya, delhi to goa oct 10, returning on the 25th")).toMatchObject({ travellers: ["priya"], back: "2026-10-25" });
    expect(read("priya needs to fly to delhi tomorrow")).toMatchObject({ travellers: ["priya"], depart: "2026-09-25" });
    expect(read("my mom to goa oct 10").travellers).toEqual(["mom"]);
    expect(read("mom and me to pokhara 10 to 25 oct, we both need wheelchairs")).toMatchObject({
      destination: "PKR",
      travellers: ["me", "mom"],
      assistance: { me: "wheelchair", mom: "wheelchair" },
    });
  });
  test("a judgment fills what the words left open, never the other way round", () => {
    const frail = { ...neutralJudgment(), assistanceFor: sure("companion"), priority: sure("fastest"), avoidsOvernight: 0.8 };
    expect(read("me and mom to goa oct 10, she is 80", frail)).toMatchObject({
      assistance: { mom: "wheelchair" },
      priority: "fastest",
      avoidOvernight: true,
    });
    // Words win: "cheapest" beats a judged priority, and a named wheelchair beats a judged "everyone".
    const loud = { ...neutralJudgment(), assistanceFor: sure("everyone"), priority: sure("fastest") };
    expect(read("me and mom to goa oct 10 cheapest, wheelchair for mom", loud)).toMatchObject({
      assistance: { mom: "wheelchair" },
      priority: "cheapest",
    });
  });
  test("completeness and whether it is a trip at all", () => {
    expect(sayCompleteness(HERO_REQUEST)).toBe(1);
    expect(sayCompleteness({ ...HERO_REQUEST, depart: null })).toBe(0.7);
    expect(sayCompleteness(read("hello there"))).toBe(0);
    expect(isTripSentence(HERO_SENTENCE, judgeOffline(HERO_SENTENCE))).toBe(true);
    expect(isTripSentence("hello there", judgeOffline("hello there"))).toBe(false);
    expect(isTripSentence("goa oct 10", neutralJudgment())).toBe(true);
    expect(isTripSentence("goa", neutralJudgment())).toBe(false);
  });
});

describe("follow: sentences while choosing and confirming", () => {
  const understood = reduceTrip(initialTrip, { type: "understood", request: HERO_REQUEST });
  const options = results(HERO_REQUEST).options;
  const chosen = reduceTrip(understood, { type: "select", optionId: options[0].id });
  const said = (text: string, state = understood, judgment = judgeOffline(text)) => follow(text, judgment, state, DEMO_PROFILE, NOW);
  const byTag = (tag: string) => options.find((o) => o.tag === tag)!;

  test("a pick and a seat in one breath", () => {
    const actions = said("the first one, aisle for mom");
    expect(actions).toEqual([
      { type: "select", optionId: options[0].id },
      { type: "seat_pref", travellerId: "mom", pref: "aisle" },
    ]);
    expect(describeFollow(actions, understood, DEMO_PROFILE)).toBe("Picks Best balance · aisle for Mom");
  });
  test("options by tag, airline and departure clock", () => {
    expect(said("the cheapest")).toEqual([{ type: "select", optionId: byTag("Cheapest").id }]);
    const airIndia = said("the air india one");
    expect(airIndia).toHaveLength(1);
    const picked = options.find((o) => o.id === (airIndia[0].type === "select" ? airIndia[0].optionId : null))!;
    expect(picked.trip.out.segments.some((s) => s.airline === "Air India")).toBe(true);
    expect(picked.tag).toBe("Fastest");
    expect(said("the 7am one")).toEqual([
      { type: "select", optionId: options.find((o) => o.trip.out.segments[0].dep.slice(11, 16) === "07:00")!.id },
    ]);
    expect(said("the 06:40 one")).toEqual([
      { type: "select", optionId: options.find((o) => o.trip.out.segments[0].dep.slice(11, 16) === "06:40")!.id },
    ]);
  });
  test("a bare weekday is read around the day the trip leaves, never in the past", () => {
    const actions = said("leave thursday instead");
    expect(actions).toEqual([{ type: "refine", patch: { depart: "2026-10-08" } }]);
    const depart = actions[0].type === "refine" ? actions[0].patch.depart! : "";
    expect(weekdayOf(depart)).toBe(4);
    expect(depart >= "2026-09-24").toBe(true);
    expect(describeFollow(actions, understood, DEMO_PROFILE)).toBe("Leaves Thu, Oct 8");
    expect(said("leave tomorrow instead")).toEqual([{ type: "refine", patch: { depart: "2026-09-25" } }]);
    expect(said("go on the 8th")).toEqual([{ type: "refine", patch: { depart: "2026-10-08" } }]);
    expect(said("leave oct 12 instead")).toEqual([{ type: "refine", patch: { depart: "2026-10-12" } }]);
  });
  test("rules can be relaxed, tightened and reweighted", () => {
    expect(said("allow overnight layovers")).toEqual([{ type: "refine", patch: { avoidOvernight: false } }]);
    expect(said("overnight is fine")).toEqual([{ type: "refine", patch: { avoidOvernight: false } }]);
    expect(said("no overnight layovers")).toEqual([{ type: "refine", patch: { avoidOvernight: true } }]);
    expect(said("cheapest first")).toEqual([{ type: "refine", patch: { priority: "cheapest" } }]);
    expect(said("fastest first")).toEqual([{ type: "refine", patch: { priority: "fastest" } }]);
    expect(said("balance price and time")).toEqual([{ type: "refine", patch: { priority: "balanced" } }]);
  });
  test("seats for one, for both, and by name", () => {
    expect(said("window for me")).toEqual([{ type: "seat_pref", travellerId: "me", pref: "window" }]);
    expect(said("aisle for both")).toEqual([
      { type: "seat_pref", travellerId: "me", pref: "aisle" },
      { type: "seat_pref", travellerId: "mom", pref: "aisle" },
    ]);
    expect(said("mom by the window and aisle for me")).toEqual([
      { type: "seat_pref", travellerId: "mom", pref: "window" },
      { type: "seat_pref", travellerId: "me", pref: "aisle" },
    ]);
    // Someone who is not on the trip gets no seat.
    expect(said("aisle for dad")).toEqual([]);
  });
  test("going back, and booking only once something is chosen", () => {
    expect(said("back to options")).toEqual([{ type: "select", optionId: null }]);
    expect(describeFollow(said("back to options"), understood, DEMO_PROFILE)).toBe("Back to options");
    expect(said("book it")).toEqual([]);
    expect(stageOf(chosen)).toBe("confirm");
    const booked = said("book it", chosen);
    expect(booked).toEqual([{ type: "book", at: new Date(NOW).toISOString() }]);
    expect(describeFollow(booked, chosen, DEMO_PROFILE)).toBe("Books");
    // A choice named in the same breath lands before the money moves.
    expect(said("book the cheapest", chosen)).toEqual([
      { type: "select", optionId: byTag("Cheapest").id },
      { type: "book", at: new Date(NOW).toISOString() },
    ]);
  });
  test("nothing is guessed", () => {
    expect(said("hello there")).toEqual([]);
    expect(said("the first one", initialTrip)).toEqual([]);
  });
  test("Jev's pick counts only when the words gave nothing", () => {
    const second = { ...neutralJudgment(), optionPick: sure("second") };
    expect(said("that one", understood, second)).toEqual([{ type: "select", optionId: options[1].id }]);
    expect(said("the cheapest", understood, second)).toEqual([{ type: "select", optionId: byTag("Cheapest").id }]);
    const unsure = { ...neutralJudgment(), optionPick: { ...sure("second"), confidence: 0.4 } };
    expect(said("that one", understood, unsure)).toEqual([]);
  });
});

describe("follow: after a cancellation", () => {
  const booked = bookedHero();
  const cancellation = eventOfKind(DEMO_EVENTS, "cancel-6E1159-2026-10-10", "cancelled")!;
  const now = toMs(cancellation.at) + MINUTE;
  const d = disruptionAt(booked.booking!, now)!;
  const at = new Date(now).toISOString();
  const said = (text: string, when = now, judgment = judgeOffline(text)) => follow(text, judgment, booked, DEMO_PROFILE, when);
  const rebook = (flightNo: string): TripAction[] => [{ type: "rebook", eventId: cancellation.id, flightNo, at }];

  test("the fixes on offer are what the words can name", () => {
    expect(stageOf(booked)).toBe("trip");
    expect(d.fixes.map((f) => f.segment.flightNo)).toContain("RA 218");
  });
  test("by clock, by airline, by ordinal", () => {
    expect(said("take the 14:10 one")).toEqual(rebook("RA 218"));
    expect(said("the nepal airlines one")).toEqual(rebook("RA 218"));
    expect(said("2pm")).toEqual(rebook("RA 218"));
    expect(said("the 2:10 one")).toEqual(rebook("RA 218"));
    expect(said("the first fix")).toEqual(rebook(d.fixes[0].segment.flightNo));
    expect(describeFollow(said("take the 14:10 one"), booked, DEMO_PROFILE)).toBe("Takes RA 218 at 14:10");
  });
  test("same day and next day", () => {
    const sameDay = d.fixes.find((f) => dateOf(f.segment.dep) === cancellation.date);
    expect(said("same day")).toEqual(sameDay ? rebook(sameDay.segment.flightNo) : []);
    // The demo's three best fixes all leave the same day, so "next day" has nothing it can book.
    const nextDay = d.fixes.find((f) => dateOf(f.segment.dep) !== cancellation.date);
    expect(said("next day")).toEqual(nextDay ? rebook(nextDay.segment.flightNo) : []);
  });
  test("nothing before the cancellation, nothing for nonsense, Jev only fills silence", () => {
    expect(said("take the 14:10 one", now - 2 * MINUTE)).toEqual([]);
    expect(said("hello there")).toEqual([]);
    const judged = { ...neutralJudgment(), followUp: sure("take_fix"), optionPick: sure("second") };
    expect(said("hmm that", now, judged)).toEqual([
      { type: "rebook", eventId: cancellation.id, flightNo: d.fixes[1].segment.flightNo, at },
    ]);
  });
});

describe("clocks in sentences", () => {
  test("every way of saying a time, and what it could mean", () => {
    const [a, b, c, e, f, g, h] = clocksIn("14:10 2:10pm 2pm 6.40 6:40am 12am 12pm");
    expect([a.hours, a.minutes]).toEqual([[14], 10]);
    expect([b.hours, b.minutes]).toEqual([[14], 10]);
    expect([c.hours, c.minutes]).toEqual([[14], null]);
    expect([e.hours, e.minutes]).toEqual([[6, 18], 40]);
    expect([f.hours, f.minutes]).toEqual([[6], 40]);
    expect(g.hours).toEqual([0]);
    expect(h.hours).toEqual([12]);
    expect(clocksIn("oct 10, the first one")).toEqual([]);
  });
  test("matching a departure", () => {
    const [dotted] = clocksIn("6.40");
    expect(clockMatches(dotted, "06:40")).toBe(true);
    expect(clockMatches(dotted, "18:40")).toBe(true);
    expect(clockMatches(dotted, "06:41")).toBe(false);
    const [hourOnly] = clocksIn("2pm");
    expect(clockMatches(hourOnly, "14:10")).toBe(true);
    expect(clockMatches(hourOnly, "02:10")).toBe(false);
  });
});

/** The type-level contract: a request read from a sentence is exactly what the reducer takes. */
const _typed: TripRequest = read(HERO_SENTENCE);
void _typed;
