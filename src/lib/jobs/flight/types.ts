import type { AirportCode } from "./airports";

export type Airline = "IndiGo" | "Air India" | "Nepal Airlines";

/** A flight that leaves later than sold. The scheduled times are kept so the card can say by how much. */
export type Delay = { minutes: number; reason: string; scheduledDep: string; scheduledArr: string };

/** One flight. `dep` and `arr` are ISO strings in the local offset of each airport. */
export type Segment = {
  flightNo: string;
  airline: Airline;
  from: AirportCode;
  to: AirportCode;
  dep: string;
  arr: string;
  wheelchair: boolean;
  /** Per person when bought on its own, e.g. to replace a missed connection nobody protects. */
  fare: number;
  delay?: Delay;
};

export type Ticketing = "single" | "separate";

/** One direction of a trip: one or more flights, sold as one ticket or as several. */
export type Itinerary = {
  id: string;
  segments: Segment[];
  ticketing: Ticketing;
  farePerPerson: number;
  /** Per person, to move to another date or fare. */
  changeFee: number;
  /** Per person, kept by the airline on a refund. Null means no refund at all. */
  refundFee: number | null;
  rules: string;
};

/** An outbound itinerary and an optional return. */
export type Trip = { id: string; out: Itinerary; back: Itinerary | null };

export type Assistance = "wheelchair";
export type SeatPref = "aisle" | "window";
export type Priority = "balanced" | "cheapest" | "fastest";

export type Traveller = { id: string; label: string; idOnFile: boolean };

/** What the product already knows about the person: their people, their home airport, how they pay. */
export type Profile = { home: AirportCode; travellers: Traveller[]; payment: string };

/**
 * What the traveller asked for. Jev and the parsers fill it from one sentence; code never invents a
 * field. Missing values stay null and render as placeholders.
 */
export type TripRequest = {
  origin: AirportCode | null;
  destination: AirportCode | null;
  depart: string | null;
  back: string | null;
  travellers: string[];
  assistance: Partial<Record<string, Assistance>>;
  avoidOvernight: boolean;
  priority: Priority;
};
