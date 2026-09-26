import { AIRPORTS, type AirportCode } from "./airports";
import { addDays, isoAt, toMs, weekdayOf } from "./time";
import type { Airline, Itinerary, Segment, Ticketing } from "./types";

/**
 * Demo inventory: hand-written schedules for Bengaluru ⇄ Kathmandu, priced by weekday. No fare here is
 * real. The shapes are: one ticket versus two, tight and overnight connections, late arrivals.
 */

type Leg = {
  flightNo: string;
  airline: Airline;
  from: AirportCode;
  to: AirportCode;
  dep: string;
  arr: string;
  /** Days after the itinerary's start date that this leg departs and lands. */
  depDay?: number;
  arrDay?: number;
  wheelchair?: boolean;
  /** Per person on its own. Defaults to the route's walk-up fare. */
  fare?: number;
};

type Fees = { changeFee: number; refundFee: number | null; rules: string };

type Template = { key: string; legs: Leg[]; ticketing: Ticketing; baseFare: number } & Fees;

const INDIGO: Fees = { changeFee: 2500, refundFee: null, rules: "Non-refundable · date change ₹2,500 per person" };
const AIR_INDIA: Fees = { changeFee: 3000, refundFee: 3500, rules: "Refundable minus ₹3,500 · date change ₹3,000 per person" };
const SPLIT: Fees = { changeFee: 2500, refundFee: null, rules: "Two tickets with separate rules · a missed connection is not protected" };

const ROUTES: Partial<Record<string, Template[]>> = {
  "BLR-KTM": [
    {
      key: "o1",
      ticketing: "single",
      baseFare: 10450,
      ...INDIGO,
      legs: [
        { flightNo: "6E 2131", airline: "IndiGo", from: "BLR", to: "DEL", dep: "06:40", arr: "09:25" },
        { flightNo: "6E 1159", airline: "IndiGo", from: "DEL", to: "KTM", dep: "11:35", arr: "13:35" },
      ],
    },
    {
      key: "o2",
      ticketing: "separate",
      baseFare: 8650,
      ...SPLIT,
      legs: [
        { flightNo: "6E 2005", airline: "IndiGo", from: "BLR", to: "DEL", dep: "05:10", arr: "07:55" },
        { flightNo: "RA 216", airline: "Nepal Airlines", from: "DEL", to: "KTM", dep: "09:30", arr: "11:30" },
      ],
    },
    {
      key: "o3",
      ticketing: "single",
      baseFare: 13075,
      ...AIR_INDIA,
      legs: [
        { flightNo: "AI 503", airline: "Air India", from: "BLR", to: "DEL", dep: "07:00", arr: "09:45" },
        { flightNo: "AI 215", airline: "Air India", from: "DEL", to: "KTM", dep: "10:55", arr: "12:55" },
      ],
    },
    {
      key: "o4",
      ticketing: "single",
      baseFare: 7900,
      ...INDIGO,
      legs: [
        { flightNo: "6E 715", airline: "IndiGo", from: "BLR", to: "CCU", dep: "19:30", arr: "22:05" },
        { flightNo: "6E 1157", airline: "IndiGo", from: "CCU", to: "KTM", dep: "09:45", arr: "11:05", depDay: 1, arrDay: 1 },
      ],
    },
    {
      key: "o5",
      ticketing: "single",
      baseFare: 9200,
      ...AIR_INDIA,
      legs: [
        { flightNo: "AI 505", airline: "Air India", from: "BLR", to: "DEL", dep: "17:15", arr: "20:00" },
        { flightNo: "AI 217", airline: "Air India", from: "DEL", to: "KTM", dep: "21:25", arr: "23:25" },
      ],
    },
  ],
  "KTM-BLR": [
    {
      key: "b1",
      ticketing: "single",
      baseFare: 10450,
      ...INDIGO,
      legs: [
        { flightNo: "6E 1160", airline: "IndiGo", from: "KTM", to: "DEL", dep: "14:30", arr: "16:00" },
        { flightNo: "6E 2132", airline: "IndiGo", from: "DEL", to: "BLR", dep: "18:20", arr: "21:05" },
      ],
    },
    {
      key: "b2",
      ticketing: "separate",
      baseFare: 8650,
      ...SPLIT,
      legs: [
        { flightNo: "RA 215", airline: "Nepal Airlines", from: "KTM", to: "DEL", dep: "12:15", arr: "13:45" },
        { flightNo: "6E 2006", airline: "IndiGo", from: "DEL", to: "BLR", dep: "15:20", arr: "18:05" },
      ],
    },
    {
      key: "b3",
      ticketing: "single",
      baseFare: 13075,
      ...AIR_INDIA,
      legs: [
        { flightNo: "AI 216", airline: "Air India", from: "KTM", to: "DEL", dep: "13:55", arr: "15:25" },
        { flightNo: "AI 504", airline: "Air India", from: "DEL", to: "BLR", dep: "16:35", arr: "19:20" },
      ],
    },
    {
      key: "b4",
      ticketing: "single",
      baseFare: 7900,
      ...INDIGO,
      legs: [
        { flightNo: "6E 1158", airline: "IndiGo", from: "KTM", to: "CCU", dep: "18:50", arr: "19:25" },
        { flightNo: "6E 716", airline: "IndiGo", from: "CCU", to: "BLR", dep: "06:30", arr: "09:05", depDay: 1, arrDay: 1 },
      ],
    },
    {
      key: "b5",
      ticketing: "single",
      baseFare: 9200,
      ...AIR_INDIA,
      legs: [
        { flightNo: "AI 218", airline: "Air India", from: "KTM", to: "DEL", dep: "20:10", arr: "21:40" },
        { flightNo: "AI 506", airline: "Air India", from: "DEL", to: "BLR", dep: "23:05", arr: "01:50", arrDay: 1 },
      ],
    },
  ],
};

/** Single flights that only appear when a disrupted leg needs somewhere to go. */
const SPARE_LEGS: Leg[] = [
  { flightNo: "RA 218", airline: "Nepal Airlines", from: "DEL", to: "KTM", dep: "14:10", arr: "16:10" },
  { flightNo: "6E 2138", airline: "IndiGo", from: "DEL", to: "BLR", dep: "20:05", arr: "22:50" },
  { flightNo: "6E 2134", airline: "IndiGo", from: "DEL", to: "BLR", dep: "20:40", arr: "23:25" },
  { flightNo: "6E 2136", airline: "IndiGo", from: "DEL", to: "BLR", dep: "06:15", arr: "09:00" },
];

/** What one flight costs on its own, per person, before the weekday factor. */
const WALK_UP_FARE: Partial<Record<string, number>> = {
  "BLR-DEL": 5400,
  "DEL-BLR": 5400,
  "DEL-KTM": 6900,
  "KTM-DEL": 6900,
  "BLR-CCU": 4800,
  "CCU-BLR": 4800,
  "CCU-KTM": 5200,
  "KTM-CCU": 5200,
};

/** Demo fares move with the weekday: a Thursday deal, a Friday peak. Index 0 is Sunday. */
const WEEKDAY_FACTOR = [1, 1.04, 0.94, 0.9, 0.73, 1.28, 1];

export const fareOn = (baseFare: number, date: string) => Math.round((baseFare * WEEKDAY_FACTOR[weekdayOf(date)]) / 50) * 50;

function toSegment(leg: Leg, date: string): Segment {
  const depDate = addDays(date, leg.depDay ?? 0);
  return {
    flightNo: leg.flightNo,
    airline: leg.airline,
    from: leg.from,
    to: leg.to,
    dep: isoAt(depDate, leg.dep, AIRPORTS[leg.from].offset),
    arr: isoAt(addDays(date, leg.arrDay ?? 0), leg.arr, AIRPORTS[leg.to].offset),
    wheelchair: leg.wheelchair ?? true,
    fare: fareOn(leg.fare ?? WALK_UP_FARE[`${leg.from}-${leg.to}`] ?? 6000, depDate),
  };
}

const templatesFor = (from: AirportCode, to: AirportCode) => ROUTES[`${from}-${to}`] ?? [];

export const hasInventory = (from: AirportCode, to: AirportCode) => templatesFor(from, to).length > 0;

/** Every itinerary from one airport to another that starts on a date. */
export function searchItineraries(from: AirportCode, to: AirportCode, date: string): Itinerary[] {
  return templatesFor(from, to).map((t) => ({
    id: `${t.key}@${date}`,
    segments: t.legs.map((leg) => toSegment(leg, date)),
    ticketing: t.ticketing,
    farePerPerson: fareOn(t.baseFare, date),
    changeFee: t.changeFee,
    refundFee: t.refundFee,
    rules: t.rules,
  }));
}

/** Single flights between two airports that depart on a date: every scheduled leg plus the spares. */
export function searchFlights(from: AirportCode, to: AirportCode, date: string): Segment[] {
  const seen = new Set<string>();
  const flights: Segment[] = [];
  for (const leg of [...Object.values(ROUTES).flatMap((ts) => (ts ?? []).flatMap((t) => t.legs)), ...SPARE_LEGS]) {
    if (leg.from !== from || leg.to !== to || seen.has(leg.flightNo)) continue;
    seen.add(leg.flightNo);
    flights.push(toSegment({ ...leg, depDay: 0, arrDay: (leg.arrDay ?? 0) - (leg.depDay ?? 0) }, date));
  }
  return flights.sort((a, b) => toMs(a.dep) - toMs(b.dep));
}

/** Airlines selling a route, for the "searched N airlines" proof line. */
export const airlinesOn = (from: AirportCode, to: AirportCode): Airline[] => [
  ...new Set(templatesFor(from, to).flatMap((t) => t.legs.map((l) => l.airline))),
];
