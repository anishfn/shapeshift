import { describe, expect, test } from "bun:test";
import { BEATS, beatById, HERO_REQUEST } from "@/lib/jobs/flight/beats";
import { type AirlineEvent, DEMO_EVENTS, eventOfKind } from "@/lib/jobs/flight/events";
import { messagesFor } from "@/lib/jobs/flight/messages";
import { compareOutcomes, outcomesFor, replay } from "@/lib/jobs/flight/outcomes";
import { DEMO_PROFILE } from "@/lib/jobs/flight/profile";
import { results } from "@/lib/jobs/flight/rank";
import { HOUR, MINUTE, toMs } from "@/lib/jobs/flight/time";
import {
  currentTrip,
  disruptionAt,
  initialTrip,
  milestones,
  momentsOf,
  passesAt,
  proposalAt,
  reduceTrip,
  spent,
  type TripState,
} from "@/lib/jobs/flight/trip";

const BOOKED_AT = "2026-09-24T10:17:00+05:30";
const FOG = eventOfKind(DEMO_EVENTS, "fog-6E1160-2026-10-25", "delayed")!;
const FARE = eventOfKind(DEMO_EVENTS, "fare-o1-2026-10-01", "fare_drop")!;
const GATE = eventOfKind(DEMO_EVENTS, "gate-6E2131-2026-10-10", "gate")!;
const fogAt = toMs(FOG.at);

function bookOption(tag: string, seatPrefs: TripState["seatPrefs"] = {}): TripState {
  const understood = reduceTrip(initialTrip, { type: "understood", request: HERO_REQUEST });
  const option = results(HERO_REQUEST).options.find((o) => o.tag === tag)!;
  return reduceTrip({ ...reduceTrip(understood, { type: "select", optionId: option.id }), seatPrefs }, { type: "book", at: BOOKED_AT });
}

describe("delays", () => {
  // The hero after the outbound cancellation was fixed: the only open question left is the fog.
  const b = beatById("rebooked").state.booking!;

  test("apply only once announced, and keep the scheduled times", () => {
    expect(currentTrip(b, fogAt - 1).back!.segments[0].dep).toBe("2026-10-25T14:30:00+05:45");
    const late = currentTrip(b, fogAt + 1).back!.segments[0];
    expect(late.dep).toBe("2026-10-25T16:30:00+05:45");
    expect(late.delay).toEqual({
      minutes: 120,
      reason: "fog at Kathmandu",
      scheduledDep: "2026-10-25T14:30:00+05:45",
      scheduledArr: "2026-10-25T16:00:00+05:30",
    });
    expect(milestones(b, fogAt + 1).backDep).toBe(toMs("2026-10-25T16:30:00+05:45"));
  });

  test("a delay that breaks the connection becomes a missed-connection disruption on the next flight", () => {
    expect(disruptionAt(b, fogAt - 1)).toBeNull();
    const d = disruptionAt(b, fogAt + 1)!;
    expect(d.kind).toBe("missed_connection");
    expect(d.direction).toBe("back");
    expect(d.segment.flightNo).toBe("6E 2132");
    expect(d.cause).toMatchObject({ minutes: 20, segment: { flightNo: "6E 1160" } });
    expect(d.protected).toBe(true);
    expect(d.fixes.map((f) => [f.segment.flightNo, f.costPerPerson])).toEqual([
      ["6E 2138", 0],
      ["6E 2134", 0],
      ["AI 506", 0],
    ]);
    expect(d.fixes[0].flags.map((f) => f.text)).toEqual(["Wheelchair, seats and bags move with you"]);
    expect(d.fixes[1].flags.map((f) => f.text)).toEqual(["Lands 23:25"]);
  });

  test("the card explains the delay and withholds the old arrival time", () => {
    const texts = momentsOf(b, fogAt + 1).map((m) => m.text);
    expect(texts).toContain("6E 1160 delayed 2h, fog at Kathmandu · misses 6E 2132 in Delhi");
    expect(texts).toContain("New arrival time comes with the fix you pick");
    const pass = passesAt(b, fogAt + 1, DEMO_PROFILE)[0];
    expect(pass.flightNo).toBe("6E 1160");
    expect(pass.boards).toBe("15:50");
    expect(pass.delay).toBe("Delayed 2h · fog at Kathmandu");
  });

  test("a delay that leaves enough time is only a notice", () => {
    const gentle: AirlineEvent[] = [{ ...FOG, newDep: "2026-10-25T15:00:00+05:45", newArr: "2026-10-25T16:30:00+05:30" }];
    expect(disruptionAt(b, fogAt + 1, gentle)).toBeNull();
    expect(momentsOf(b, fogAt + 1, gentle).map((m) => m.text)).toContain(
      "6E 1160 delayed 30m, fog at Kathmandu · 1h 50m to connect, still fine",
    );
  });

  test("two separate tickets mean the next flight is yours to buy", () => {
    const cheap = bookOption("Cheapest");
    const d = disruptionAt(cheap.booking!, fogAt + 1)!;
    expect(d.kind).toBe("missed_connection");
    expect(d.segment.flightNo).toBe("6E 2006");
    expect(d.protected).toBe(false);
    // Landing at 16:15 leaves 2h 05m for the 18:20, which is fine even with a wheelchair. It just costs money now.
    expect(d.fixes[0].segment.flightNo).toBe("6E 2132");
    expect(d.fixes[0].costPerPerson).toBe(5400);
    // It is Nepal Airlines' fog event that hit this trip, not IndiGo's.
    expect(d.event.id).toBe("fog-RA215-2026-10-25");
    const bought = reduceTrip(cheap, { type: "rebook", eventId: d.event.id, flightNo: "6E 2132", at: "2026-10-25T09:45:00+05:45" });
    expect(bought.booking!.changes[0].paid).toBe(10800);
    expect(spent(bought.booking!)).toEqual({ total: 34600, extra: 10800, saved: 0, net: 45400 });
    expect(momentsOf(bought.booking!, fogAt + HOUR).map((m) => m.text)).toContainEqual(
      expect.stringMatching(/^Moved to 6E 2132 at 18:20 · seats \d+[A-F] and \d+[A-F] · paid ₹10,800$/),
    );
  });
});

describe("fares watched after booking", () => {
  test("a drop smaller than the change fee is noted and left alone", () => {
    const b = bookOption("Best balance").booking!;
    expect(proposalAt(b, toMs(FARE.at) + 1)).toBeNull();
    expect(momentsOf(b, toMs(FARE.at) + 1).map((m) => m.text)).toContain("Fare dropped ₹2,400 · change fee ₹5,000 · left alone");
  });

  test("a drop that beats the fee is proposed, and only moves money when taken", () => {
    const fast = bookOption("Fastest");
    // Saturday's Air India fare is ₹13,100 a head; ₹8,100 is a ₹5,000 drop each, ₹10,000 for two.
    const drop: AirlineEvent = { id: "fare-o3", kind: "fare_drop", itineraryId: "o3@2026-10-10", at: FARE.at, farePerPerson: 8100 };
    const at = toMs(FARE.at) + MINUTE;
    const p = proposalAt(fast.booking!, at, [drop])!;
    expect(p).toMatchObject({ direction: "out", drop: 10000, fee: 6000, net: 4000 });
    expect(spent(fast.booking!).saved).toBe(0);
    const taken = reduceTrip(fast, { type: "refare", eventId: "fare-o3", at: new Date(at).toISOString() }, [drop]);
    expect(spent(taken.booking!)).toMatchObject({ saved: 4000, net: 48400 });
    expect(proposalAt(taken.booking!, at + HOUR, [drop])).toBeNull();
    expect(momentsOf(taken.booking!, at + HOUR, [drop]).map((m) => m.text)).toContain("Took the lower fare · saved ₹4,000");
    // Nothing to take at the wrong time or for the wrong event.
    expect(reduceTrip(fast, { type: "refare", eventId: "fare-o3", at: "2026-09-30T09:00:00+05:30" }, [drop])).toBe(fast);
    expect(reduceTrip(fast, { type: "refare", eventId: "nope", at: new Date(at).toISOString() }, [drop])).toBe(fast);
  });
});

describe("gates", () => {
  test("show up on the pass and in the timeline", () => {
    const b = bookOption("Best balance").booking!;
    const at = toMs(GATE.at) + MINUTE;
    expect(passesAt(b, at, DEMO_PROFILE)[0]).toMatchObject({ flightNo: "6E 2131", gate: "14" });
    expect(momentsOf(b, at).map((m) => m.text)).toContain("Gate 14 for 6E 2131");
  });
});

describe("the whole story", () => {
  test("the hero is moved twice for free and keeps every rule", () => {
    const home = beatById("home").state.booking!;
    expect(home.changes.map((c) => [c.eventId, c.segment.flightNo, c.paid])).toEqual([
      ["cancel-6E1159-2026-10-10", "RA 218", 0],
      ["fog-6E1160-2026-10-25", "6E 2138", 0],
    ]);
    const end = beatById("home").now;
    expect(currentTrip(home, end).back!.segments.map((s) => s.flightNo)).toEqual(["6E 1160", "6E 2138"]);
    expect(momentsOf(home, end).map((m) => m.text)).toContain("Home in Bengaluru at 22:50");
    expect(disruptionAt(home, end)).toBeNull();
  });

  test("scrubbing the clock back un-happens the fix but not the fog", () => {
    const home = beatById("home").state.booking!;
    expect(disruptionAt(home, fogAt + MINUTE)?.segment.flightNo).toBe("6E 2132");
    expect(currentTrip(home, fogAt + MINUTE).back!.segments[0].delay?.minutes).toBe(120);
  });
});

describe("what if you had picked the other one", () => {
  const outcomes = outcomesFor(HERO_REQUEST, BOOKED_AT);
  const by = (tag: string) => outcomes.find((o) => o.option.tag === tag)!;

  test("the balanced trip is hit twice and pays nothing", () => {
    const o = by("Best balance");
    expect(o.episodes.map((e) => e.kind)).toEqual(["cancelled", "missed_connection"]);
    expect(o.paid).toBe(0);
    expect(o.verdict).toBe("nothing extra · kept every rule");
    expect(o.episodes[1].text).toBe("6E 1160 2h late, missed 6E 2132 · moved free to 6E 2138 at 20:05");
  });

  test("the cheapest trip dodges the cancellation and pays for the fog", () => {
    const o = by("Cheapest");
    expect(o.episodes.map((e) => e.kind)).toEqual(["missed_connection"]);
    expect(o.episodes[0].protected).toBe(false);
    expect(o.paid).toBe(10800);
    expect(o.verdict).toBe("₹10,800 extra · kept every rule");
    expect(o.episodes[0].text).toBe("RA 215 2h 30m late, missed 6E 2006 · bought to 6E 2132 at 18:20 for ₹10,800");
  });

  test("the fastest trip is protected too", () => {
    const o = by("Fastest");
    expect(o.episodes.map((e) => [e.kind, e.protected, e.paid])).toEqual([["missed_connection", true, 0]]);
  });

  test("the comparison reads as money in the end", () => {
    const chosen = by("Best balance").option.id;
    expect(compareOutcomes(outcomes, chosen)).toEqual([
      "Cheapest: ₹7,200 less up front, ₹10,800 more on the way · ₹3,600 worse in the end",
      "Fastest: ₹10,600 more up front, nothing more on the way · ₹10,600 worse in the end",
    ]);
  });

  test("a replay with no events has nothing to say", () => {
    expect(replay(HERO_REQUEST, by("Cheapest").option, BOOKED_AT, []).verdict).toBe("Nothing went wrong");
  });
});

describe("Mom's phone", () => {
  const home = beatById("home").state.booking!;

  test("only says what concerns her, in order", () => {
    const texts = messagesFor(home, beatById("home").now, DEMO_PROFILE, "mom").map((m) => m.text);
    expect(texts[0]).toBe("Trip to Kathmandu booked with You · Sat, Oct 10 – Sun, Oct 25 · PNR " + home.pnr);
    expect(texts).toContainEqual(
      expect.stringMatching(/^Checked in · 6E 2131 BLR–DEL 06:40 · seat \d+C · a wheelchair meets you at the curb$/),
    );
    expect(texts).toContain("Leave home by 04:30");
    expect(texts).toContain("6E 1159 to Kathmandu is cancelled · a new flight is being picked, nothing for you to do");
    expect(texts).toContainEqual(
      expect.stringMatching(/^New flight · RA 218 DEL–KTM 14:10 · seat \d+C · lands Kathmandu 16:10 · wheelchair confirmed$/),
    );
    expect(texts).toContain("Gate 14 for 6E 2131 · boards 06:00");
    expect(texts).toContain("Landed in Kathmandu · wheelchair at the gate");
    expect(texts).toContain("6E 1160 delayed 2h, fog at Kathmandu · now leaves 16:30");
    expect(texts[texts.length - 1]).toBe("Home in Bengaluru");
  });

  test("nothing from the future leaks", () => {
    const early = messagesFor(home, toMs(BOOKED_AT) + HOUR, DEMO_PROFILE, "mom");
    expect(early).toHaveLength(1);
    expect(messagesFor(home, toMs(BOOKED_AT) + HOUR, DEMO_PROFILE, "me")[0].text).toBe(
      "Trip to Kathmandu booked with Mom · Sat, Oct 10 – Sun, Oct 25 · PNR " + home.pnr,
    );
  });

  test("the fixture beats are all reachable by id", () => {
    expect(BEATS.map((b) => b.id)).toContain("fog");
    expect(() => beatById("nope")).toThrow();
  });
});
