"use client";

import { MessageSquare, Repeat2 } from "lucide-react";
import { useMemo } from "react";
import { Meta } from "@/components/intents/shared";
import { messagesFor } from "@/lib/jobs/flight/messages";
import { compareOutcomes, type Outcome, outcomesFor } from "@/lib/jobs/flight/outcomes";
import { labelOf } from "@/lib/jobs/flight/profile";
import { offsetOf } from "@/lib/jobs/flight/airports";
import { dayLabel, wallClock } from "@/lib/jobs/flight/time";
import type { Booking } from "@/lib/jobs/flight/trip";
import type { Profile, TripRequest } from "@/lib/jobs/flight/types";
import { formatAmount } from "@/lib/parse/common";
import { cn } from "@/lib/utils";

/**
 * Lab-only panels. "What if" replays the same events on every option that was offered, so the
 * warnings on the choose screen can be seen paying off (or not). The phones show what everyone else
 * on the trip is told, which the booker never has to forward.
 */

export function WhatIf({ request, booking }: { request: TripRequest; booking: Booking }) {
  const outcomes = useMemo(() => outcomesFor(request, booking.bookedAt, undefined, booking.seatPrefs), [request, booking]);
  const lines = compareOutcomes(outcomes, booking.trip.id);
  return (
    <section
      aria-label="What if you had picked another option"
      className="rounded-shell border-border bg-card mt-4 border p-5 shadow-[var(--shadow-rest)]"
    >
      <div className="mb-3 flex items-center gap-2">
        <Repeat2 className="text-muted-foreground size-4" aria-hidden />
        <span className="text-muted-foreground text-[13px] leading-5 font-medium">What if you had picked another one</span>
      </div>
      <p className="text-ink-2 mb-3 text-[14px] leading-5">
        The same events, replayed on every option you were shown, taking the first fix each time.
      </p>
      <ul className="mb-4 flex flex-col gap-1">
        {lines.map((line) => (
          <li key={line} className="text-[14px] leading-5 font-[550]">
            {line}
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {outcomes.map((o) => (
          <OutcomeCard key={o.option.id} outcome={o} chosen={o.option.id === booking.trip.id} />
        ))}
      </div>
    </section>
  );
}

function OutcomeCard({ outcome, chosen }: { outcome: Outcome; chosen: boolean }) {
  return (
    <div className={cn("flex flex-col gap-1.5 rounded-md border p-3", chosen ? "border-brand bg-brand-soft" : "border-border")}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] leading-[18px] font-[550]">
          {outcome.option.tag}
          {chosen && <span className="text-brand"> · yours</span>}
        </span>
        <span className="text-[13px] leading-[18px] tabular-nums">{formatAmount(outcome.upfront)}</span>
      </div>
      <ul className="flex flex-col gap-1">
        {outcome.episodes.length === 0 && <li className="text-muted-foreground text-[12px] leading-4">Nothing went wrong</li>}
        {outcome.episodes.map((e) => (
          <li key={e.eventId} className={cn("text-[12px] leading-4", e.paid ? "text-caution-text" : "text-ink-2")}>
            {e.text}
          </li>
        ))}
      </ul>
      <Meta className="mt-auto">{outcome.verdict}</Meta>
    </div>
  );
}

/** One phone per companion: what the product tells them, up to now. */
export function Phones({ booking, now, profile }: { booking: Booking; now: number; profile: Profile }) {
  const companions = booking.travellers.filter((id) => id !== "me");
  if (!companions.length) return null;
  return (
    <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
      {companions.map((id) => (
        <Phone key={id} booking={booking} now={now} profile={profile} travellerId={id} />
      ))}
    </div>
  );
}

function Phone({ booking, now, profile, travellerId }: { booking: Booking; now: number; profile: Profile; travellerId: string }) {
  const messages = messagesFor(booking, now, profile, travellerId);
  const home = booking.trip.out.segments[0].from;
  return (
    <section
      aria-label={`${labelOf(profile, travellerId)}'s phone`}
      className="rounded-shell border-border bg-card flex flex-col gap-2 border p-5 shadow-[var(--shadow-rest)]"
    >
      <div className="flex items-center gap-2">
        <MessageSquare className="text-muted-foreground size-4" aria-hidden />
        <span className="text-muted-foreground text-[13px] leading-5 font-medium">{labelOf(profile, travellerId)}&rsquo;s phone</span>
        <span className="text-muted-foreground ms-auto text-[12px] leading-4 tabular-nums">{messages.length}</span>
      </div>
      <ol className="flex flex-col gap-1.5">
        {messages.length === 0 && <li className="text-muted-foreground text-[13px] leading-[18px]">Nothing yet</li>}
        {messages.slice(-6).map((msg) => {
          const w = wallClock(msg.at, offsetOf(home));
          return (
            <li key={msg.id} className="bg-secondary rounded-lg px-3 py-2">
              <span className="text-muted-foreground block text-[11px] leading-4 tabular-nums">
                {dayLabel(w.date)} · {w.clock}
              </span>
              <span className="text-foreground block text-[13px] leading-[18px]">{msg.text}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
