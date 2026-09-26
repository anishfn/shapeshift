import { cityOf, offsetOf } from "./airports";
import { type AirlineEvent, DEMO_EVENTS } from "./events";
import { labelOf } from "./profile";
import { dateOf, dayLabel, formatDuration, clockOf, toMs, wallClock } from "./time";
import { BOARDING, type Booking, currentTrip, milestones, seatsOn } from "./trip";
import type { Profile, Segment } from "./types";

/**
 * What each traveller's phone says. The person who booked sees the card; everyone else gets short
 * messages with only what concerns them: their seat, their gate, their new flight. Family coordination
 * is part of the job, so the product does it instead of the booker forwarding screenshots.
 */

export type Message = { id: string; at: number; text: string };

const clockAt = (ms: number, offset: string) => wallClock(ms, offset).clock;

export function messagesFor(
  booking: Booking,
  now: number,
  profile: Profile,
  travellerId: string,
  events: AirlineEvent[] = DEMO_EVENTS,
): Message[] {
  const trip = currentTrip(booking, now, events);
  const m = milestones(booking, now, events);
  const booked = toMs(booking.bookedAt);
  const helped = booking.assistance[travellerId] === "wheelchair";
  const others = booking.travellers.filter((id) => id !== travellerId).map((id) => labelOf(profile, id));
  const home = trip.out.segments[0].from;
  const away = trip.out.segments[trip.out.segments.length - 1].to;
  const seat = (s: Segment) => seatsOn(booking, s)[travellerId];
  const flightLine = (s: Segment) => `${s.flightNo} ${s.from}–${s.to} ${clockOf(s.dep)} · seat ${seat(s)}`;

  const out: Message[] = [
    {
      id: "booked",
      at: booked,
      text: `Trip to ${cityOf(away)} booked${others.length ? ` with ${others.join(", ")}` : ""} · ${dayLabel(dateOf(trip.out.segments[0].dep))}${
        trip.back ? ` – ${dayLabel(dateOf(trip.back.segments[0].dep))}` : ""
      } · PNR ${booking.pnr}`,
    },
    {
      id: "checkin-out",
      at: m.outCheckin,
      text: `Checked in · ${flightLine(trip.out.segments[0])}${helped ? " · a wheelchair meets you at the curb" : ""}`,
    },
    { id: "leave-home", at: m.leaveHome, text: `Leave home by ${clockAt(m.leaveHome, offsetOf(home))}` },
    { id: "landed-out", at: m.outArr, text: `Landed in ${cityOf(away)}${helped ? " · wheelchair at the gate" : ""}` },
  ];

  if (trip.back && m.backCheckin !== null && m.leaveForAirport !== null && m.backArr !== null) {
    out.push(
      { id: "checkin-back", at: m.backCheckin, text: `Checked in for home · ${flightLine(trip.back.segments[0])}` },
      { id: "leave-back", at: m.leaveForAirport, text: `Leave for the airport by ${clockAt(m.leaveForAirport, offsetOf(away))}` },
      { id: "landed-back", at: m.backArr, text: `Home in ${cityOf(home)}` },
    );
  }

  for (const e of events) {
    const at = toMs(e.at);
    if (at > now || at < booked) continue;
    if (e.kind === "gate") {
      const flight = [...trip.out.segments, ...(trip.back?.segments ?? [])].find(
        (s) => s.flightNo === e.flightNo && dateOf(s.delay?.scheduledDep ?? s.dep) === e.date,
      );
      if (flight)
        out.push({
          id: `event-${e.id}`,
          at,
          text: `Gate ${e.gate} for ${e.flightNo} · boards ${clockAt(toMs(flight.dep) - BOARDING, offsetOf(flight.from))}`,
        });
    }
    if (e.kind === "cancelled") {
      const sold = [...booking.trip.out.segments, ...(booking.trip.back?.segments ?? [])].find(
        (s) => s.flightNo === e.flightNo && dateOf(s.dep) === e.date,
      );
      if (sold)
        out.push({
          id: `event-${e.id}`,
          at,
          text: `${e.flightNo} to ${cityOf(sold.to)} is cancelled · a new flight is being picked, nothing for you to do`,
        });
    }
    if (e.kind === "delayed") {
      const flight = [...trip.out.segments, ...(trip.back?.segments ?? [])].find((s) => s.flightNo === e.flightNo && s.delay);
      if (flight?.delay)
        out.push({
          id: `event-${e.id}`,
          at,
          text: `${e.flightNo} delayed ${formatDuration(flight.delay.minutes)}, ${e.reason} · now leaves ${clockOf(flight.dep)}`,
        });
    }
  }

  for (const c of booking.changes) {
    out.push({
      id: `change-${c.eventId}`,
      at: toMs(c.at),
      text: `New flight · ${flightLine(c.segment)} · lands ${cityOf(c.segment.to)} ${clockOf(c.segment.arr)}${helped ? " · wheelchair confirmed" : ""}`,
    });
  }

  return out.filter((msg) => msg.at <= now).sort((a, b) => a.at - b.at);
}
