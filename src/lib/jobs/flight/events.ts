/**
 * Things the world does to a trip after it is sold. Every event has an `at`: the card only knows about
 * it once the clock passes that moment, so scrubbing time backwards makes it un-happen.
 */
type Base = { id: string; at: string };

export type AirlineEvent =
  | (Base & { kind: "cancelled"; flightNo: string; date: string; reason: string })
  | (Base & { kind: "delayed"; flightNo: string; date: string; reason: string; newDep: string; newArr: string })
  | (Base & { kind: "gate"; flightNo: string; date: string; gate: string })
  /** The itinerary you bought now sells for less. Money only moves if you say so. */
  | (Base & { kind: "fare_drop"; itineraryId: string; farePerPerson: number });

export type EventKind = AirlineEvent["kind"];

/** Events that name one flight on one date. */
export type FlightEvent = Extract<AirlineEvent, { flightNo: string }>;

export const isFlightEvent = (e: AirlineEvent): e is FlightEvent => "flightNo" in e;

const FOG = "2026-10-25T09:40:00+05:45";

/**
 * Scripted for the demo, in the order they happen:
 * 1. A week after booking, the outbound fare drops, but not by enough to beat the change fee.
 * 2. On the morning of travel, the Delhi to Kathmandu leg is cancelled.
 * 3. A gate is announced for the first flight.
 * 4. On the way home, fog at Kathmandu delays every afternoon departure to Delhi, which breaks the
 *    onward connection for anyone on a tight ticket.
 */
export const DEMO_EVENTS: AirlineEvent[] = [
  { id: "fare-o1-2026-10-01", kind: "fare_drop", itineraryId: "o1@2026-10-10", at: "2026-10-01T09:00:00+05:30", farePerPerson: 9250 },
  {
    id: "cancel-6E1159-2026-10-10",
    kind: "cancelled",
    flightNo: "6E 1159",
    date: "2026-10-10",
    at: "2026-10-10T05:02:00+05:30",
    reason: "operational",
  },
  { id: "gate-6E2131-2026-10-10", kind: "gate", flightNo: "6E 2131", date: "2026-10-10", at: "2026-10-10T05:30:00+05:30", gate: "14" },
  {
    id: "fog-RA215-2026-10-25",
    kind: "delayed",
    flightNo: "RA 215",
    date: "2026-10-25",
    at: FOG,
    reason: "fog at Kathmandu",
    newDep: "2026-10-25T14:45:00+05:45",
    newArr: "2026-10-25T16:15:00+05:30",
  },
  {
    id: "fog-6E1160-2026-10-25",
    kind: "delayed",
    flightNo: "6E 1160",
    date: "2026-10-25",
    at: FOG,
    reason: "fog at Kathmandu",
    newDep: "2026-10-25T16:30:00+05:45",
    newArr: "2026-10-25T18:00:00+05:30",
  },
  {
    id: "fog-AI216-2026-10-25",
    kind: "delayed",
    flightNo: "AI 216",
    date: "2026-10-25",
    at: FOG,
    reason: "fog at Kathmandu",
    newDep: "2026-10-25T15:40:00+05:45",
    newArr: "2026-10-25T17:10:00+05:30",
  },
];

export const eventById = (events: AirlineEvent[], id: string): AirlineEvent | null => events.find((e) => e.id === id) ?? null;

/** One event by id, narrowed to the kind the caller expects. */
export function eventOfKind<K extends EventKind>(events: AirlineEvent[], id: string, kind: K): Extract<AirlineEvent, { kind: K }> | null {
  const event = eventById(events, id);
  return event?.kind === kind ? (event as Extract<AirlineEvent, { kind: K }>) : null;
}
