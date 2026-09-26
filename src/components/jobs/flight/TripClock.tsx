"use client";

import { offsetOf } from "@/lib/jobs/flight/airports";
import { type AirlineEvent, DEMO_EVENTS } from "@/lib/jobs/flight/events";
import { dayLabel, HOUR, MINUTE, toMs, wallClock } from "@/lib/jobs/flight/time";
import { type Booking, currentTrip, milestones } from "@/lib/jobs/flight/trip";

const EVENT_LABEL: Record<AirlineEvent["kind"], string> = { cancelled: "Cancelled", delayed: "Delayed", gate: "Gate", fare_drop: "Fare" };

export type ClockMark = { label: string; at: number };

/** Every moment worth jumping to, in order: milestones plus every event that touches the window. */
export function marksFor(booking: Booking, events: AirlineEvent[] = DEMO_EVENTS): { start: number; end: number; marks: ClockMark[] } {
  // Marks come from the trip as it finally stands, so they stay put while you scrub.
  const m = milestones(booking, Number.POSITIVE_INFINITY, events);
  const start = m.booked;
  const end = (m.backArr ?? m.outArr) + 6 * HOUR;
  const seen = new Set<string>();
  const eventMarks = events.flatMap((e) => {
    const at = toMs(e.at);
    const key = `${EVENT_LABEL[e.kind]}@${at}`;
    if (at <= start || at >= end || seen.has(key)) return [];
    seen.add(key);
    return [{ label: EVENT_LABEL[e.kind], at }];
  });
  const marks = [
    { label: "Check-in", at: m.outCheckin },
    { label: "Land", at: m.outArr },
    ...(m.backCheckin !== null ? [{ label: "Return check-in", at: m.backCheckin }] : []),
    ...(m.backArr !== null ? [{ label: "Home", at: m.backArr }] : []),
    ...eventMarks,
  ].sort((a, b) => a.at - b.at);
  return { start, end, marks };
}

/** The first mark after `now`, so a demo can step through the trip one moment at a time. */
export function nextMark(booking: Booking, now: number, events: AirlineEvent[] = DEMO_EVENTS): ClockMark | null {
  return marksFor(booking, events).marks.find((mark) => mark.at + MINUTE > now + MINUTE) ?? null;
}

/**
 * Drag through the trip. The card derives everything from the clock, so nothing is replayed. Demo-only:
 * a real trip card would just read the wall clock.
 */
export function TripClock({ booking, now, onChange }: { booking: Booking; now: number; onChange: (t: number) => void }) {
  const { start, end, marks } = marksFor(booking);
  const origin = currentTrip(booking, now).out.segments[0].from;
  const w = wallClock(now, offsetOf(origin));
  const position = (t: number) => `${((t - start) / (end - start)) * 100}%`;

  return (
    <section aria-label="Trip clock" className="rounded-shell border-border bg-card mt-4 border p-5 shadow-[var(--shadow-rest)]">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <span className="text-muted-foreground text-[13px] leading-5 font-medium">Trip clock</span>
        <span className="text-[15px] leading-[22px] font-[550] tabular-nums">
          {dayLabel(w.date)} · {w.clock}
        </span>
      </div>
      <div className="relative">
        <input
          type="range"
          aria-label="Trip time"
          aria-valuetext={`${dayLabel(w.date)} ${w.clock}`}
          min={start}
          max={end}
          step={5 * MINUTE}
          value={now}
          onChange={(e) => onChange(Number(e.target.value))}
          className="relative z-[1] w-full accent-[var(--brand)]"
        />
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-full mt-0.5 h-2">
          {marks.map((mark) => (
            <span
              key={mark.label + mark.at}
              className="bg-line-strong absolute size-1.5 -translate-x-1/2 rounded-full"
              style={{ left: position(mark.at) }}
            />
          ))}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {marks.map((mark) => (
          <button
            key={mark.label + mark.at}
            type="button"
            onClick={() => onChange(mark.at + MINUTE)}
            className="bg-secondary text-ink-2 hover:text-foreground focus-visible:outline-ring inline-flex h-7 items-center rounded-full px-2.5 text-[13px] font-medium transition-[color,scale] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 active:scale-[0.96]"
          >
            {mark.label}
          </button>
        ))}
      </div>
    </section>
  );
}
