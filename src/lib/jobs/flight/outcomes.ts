import { formatAmount } from "@/lib/parse/common";
import { type AirlineEvent, DEMO_EVENTS } from "./events";
import { type Option, results } from "./rank";
import { clockOf, formatDuration, MINUTE, toMs } from "./time";
import { disruptionFor, milestones, reduceTrip, type TripState } from "./trip";
import type { SeatPref, TripRequest } from "./types";

/**
 * What would have happened on each of the offered trips, given the same events. The demo's argument in
 * one function: the warnings on the choose screen are not footnotes, they are what the trip costs when
 * the world goes wrong. Every replay runs the real reducer and takes the first fix each time.
 */

export type Episode = {
  eventId: string;
  at: number;
  kind: "cancelled" | "missed_connection" | "stranded";
  text: string;
  protected: boolean;
  /** Extra money, total for everyone. */
  paid: number;
  /** Rules the fix taken had to break, in words. */
  broke: string[];
};

export type Outcome = {
  option: Option;
  upfront: number;
  paid: number;
  episodes: Episode[];
  /** When everyone was finally home, or landed for a one-way trip. */
  home: number | null;
  verdict: string;
};

const byTime = (events: AirlineEvent[]) => [...events].sort((a, b) => toMs(a.at) - toMs(b.at));

/** Book one option, then live through every event, taking the best fix on offer each time. */
export function replay(
  request: TripRequest,
  option: Option,
  bookedAt: string,
  events: AirlineEvent[] = DEMO_EVENTS,
  seatPrefs: Partial<Record<string, SeatPref>> = {},
): Outcome {
  let state: TripState = reduceTrip({ request, seatPrefs, selectedId: option.id, booking: null }, { type: "book", at: bookedAt }, events);
  const episodes: Episode[] = [];

  for (const event of byTime(events)) {
    const booking = state.booking;
    if (!booking || toMs(event.at) < toMs(booking.bookedAt)) continue;
    const at = toMs(event.at) + MINUTE;
    const disruption = disruptionFor(booking, event, at, events);
    if (!disruption) continue;
    const fix = disruption.fixes[0];
    const people = booking.travellers.length;
    const late = disruption.cause ? formatDuration(disruption.cause.segment.delay?.minutes ?? 0) : "";
    const lead =
      disruption.kind === "cancelled"
        ? `${disruption.segment.flightNo} cancelled`
        : `${disruption.cause?.segment.flightNo} ${late} late, missed ${disruption.segment.flightNo}`;
    if (!fix) {
      episodes.push({
        eventId: event.id,
        at,
        kind: "stranded",
        text: `${lead} · no seats anywhere`,
        protected: disruption.protected,
        paid: 0,
        broke: [],
      });
      continue;
    }
    const paid = fix.costPerPerson * people;
    const moved = `${disruption.protected ? "moved free" : "bought"} to ${fix.segment.flightNo} at ${clockOf(fix.segment.dep)}`;
    episodes.push({
      eventId: event.id,
      at,
      kind: disruption.kind,
      text: `${lead} · ${moved}${paid ? ` for ${formatAmount(paid)}` : ""}`,
      protected: disruption.protected,
      paid,
      broke: fix.flags.filter((f) => f.level === "warn").map((f) => f.text),
    });
    state = reduceTrip(
      state,
      { type: "rebook", eventId: event.id, flightNo: fix.segment.flightNo, at: new Date(at).toISOString() },
      events,
    );
  }

  const booking = state.booking;
  const paid = episodes.reduce((sum, e) => sum + e.paid, 0);
  const broke = episodes.flatMap((e) => e.broke);
  const stranded = episodes.some((e) => e.kind === "stranded");
  const m = booking ? milestones(booking, Number.POSITIVE_INFINITY, events) : null;
  const verdict = stranded
    ? "Stranded with no flight on offer"
    : !episodes.length
      ? "Nothing went wrong"
      : [paid ? `${formatAmount(paid)} extra` : "nothing extra", broke.length ? `broke: ${broke.join(", ")}` : "kept every rule"].join(
          " · ",
        );

  return { option, upfront: option.total, paid, episodes, home: m ? (m.backArr ?? m.outArr) : null, verdict };
}

/** Every offered option, replayed. */
export function outcomesFor(
  request: TripRequest,
  bookedAt: string,
  events: AirlineEvent[] = DEMO_EVENTS,
  seatPrefs: Partial<Record<string, SeatPref>> = {},
): Outcome[] {
  return results(request).options.map((option) => replay(request, option, bookedAt, events, seatPrefs));
}

/** "Cheapest: ₹7,200 less up front, ₹10,800 more on the way · ₹3,600 worse in the end." */
export function compareOutcomes(outcomes: Outcome[], chosenId: string): string[] {
  const chosen = outcomes.find((o) => o.option.id === chosenId);
  if (!chosen) return [];
  return outcomes
    .filter((o) => o.option.id !== chosenId)
    .map((o) => {
      const upfront = chosen.upfront - o.upfront;
      const onTheWay = o.paid - chosen.paid;
      const end = o.upfront + o.paid - (chosen.upfront + chosen.paid);
      const parts = [
        upfront === 0 ? "same price up front" : `${formatAmount(Math.abs(upfront))} ${upfront > 0 ? "less" : "more"} up front`,
        onTheWay === 0 ? "nothing more on the way" : `${formatAmount(Math.abs(onTheWay))} ${onTheWay > 0 ? "more" : "less"} on the way`,
      ];
      const tail = end === 0 ? "same in the end" : `${formatAmount(Math.abs(end))} ${end > 0 ? "worse" : "better"} in the end`;
      return `${o.option.tag}: ${parts.join(", ")} · ${tail}`;
    });
}
