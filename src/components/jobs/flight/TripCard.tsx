"use client";

import { CircleCheck, Clock, ShieldCheck } from "lucide-react";
import { Field, Meta } from "@/components/intents/shared";
import { Button } from "@/components/ui/button";
import { cityOf } from "@/lib/jobs/flight/airports";
import { clockOf, dateOf, dayLabel, formatDuration } from "@/lib/jobs/flight/time";
import {
  type Booking,
  currentTrip,
  type Disruption,
  disruptionAt,
  momentsOf,
  type Pass,
  passesAt,
  phaseOf,
  phasesFor,
  type Proposal,
  proposalAt,
  spent,
  travellersLabel,
} from "@/lib/jobs/flight/trip";
import type { Profile } from "@/lib/jobs/flight/types";
import { formatAmount } from "@/lib/parse/common";
import { cn } from "@/lib/utils";
import { FlagList, StepRail } from "./parts";

/**
 * The booking card after the booking. It keeps changing shape until you land: it checks you in, hands
 * you boarding passes, watches fares, and when a flight breaks it proposes fixes that keep what you
 * asked for. Anything that moves money waits for a word from you.
 */
export function TripCard({
  booking,
  now,
  profile,
  onRebook,
  onRefare,
}: {
  booking: Booking;
  now: number;
  profile: Profile;
  onRebook: (eventId: string, flightNo: string) => void;
  onRefare: (eventId: string) => void;
}) {
  const trip = currentTrip(booking, now);
  const phase = phaseOf(booking, now);
  const disruption = disruptionAt(booking, now);
  const proposal = disruption ? null : proposalAt(booking, now);
  const moments = momentsOf(booking, now);
  const done = moments.filter((m) => m.status === "done").slice(-4);
  const next = moments.filter((m) => m.status === "next").slice(0, 2);
  const passes = passesAt(booking, now, profile);
  const destination = trip.out.segments[trip.out.segments.length - 1].to;
  const money = spent(booking, now);

  return (
    <div className="flex flex-col gap-3">
      <Field index={0} className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 className="text-[17px] leading-6 font-[550]">
          {cityOf(destination)} · {dayLabel(dateOf(trip.out.segments[0].dep))}
          {trip.back ? ` – ${dayLabel(dateOf(trip.back.segments[0].dep))}` : ""}
        </h2>
        <Meta>
          {travellersLabel(booking.travellers, profile)} · {formatAmount(money.net)}
          {money.extra > 0 && <span className="text-caution-text"> · {formatAmount(money.extra)} extra</span>}
          {money.saved > 0 && <span className="text-positive"> · {formatAmount(money.saved)} back</span>}
        </Meta>
      </Field>

      <Field index={1}>
        <StepRail steps={phasesFor(booking)} current={phase} label="Trip progress" />
      </Field>

      {disruption && (
        <Field index={2}>
          <DisruptionPanel disruption={disruption} people={booking.travellers.length} onRebook={onRebook} />
        </Field>
      )}

      {proposal && (
        <Field index={2}>
          <ProposalPanel proposal={proposal} onRefare={onRefare} />
        </Field>
      )}

      <Field index={3}>
        <ul className="flex flex-col gap-1.5">
          {[...done, ...next].map((m) => (
            <li
              key={m.id}
              className={cn("flex items-start gap-2 text-[14px] leading-5", m.status === "done" ? "text-foreground" : "text-ink-2")}
            >
              {m.status === "done" ? (
                <CircleCheck className="text-positive mt-0.5 size-4 shrink-0" aria-label="Done" />
              ) : (
                <Clock className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-label="Coming up" />
              )}
              {m.text}
            </li>
          ))}
        </ul>
      </Field>

      {passes.length > 0 && (
        <Field index={4} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {passes.map((pass) => (
            <BoardingPass key={pass.travellerId} pass={pass} />
          ))}
        </Field>
      )}

      {phase !== "home" && (
        <Field index={5}>
          <Meta className="flex items-center gap-1.5">
            <ShieldCheck className="size-3.5" aria-hidden />
            Watching your flights and fares for changes
          </Meta>
        </Field>
      )}
    </div>
  );
}

function DisruptionPanel({
  disruption,
  people,
  onRebook,
}: {
  disruption: Disruption;
  people: number;
  onRebook: (eventId: string, flightNo: string) => void;
}) {
  const { event, segment, cause, fixes } = disruption;
  const title =
    disruption.kind === "cancelled"
      ? `${segment.flightNo} ${cityOf(segment.from)} to ${cityOf(segment.to)} is cancelled`
      : `${cause?.segment.flightNo} is ${formatDuration(cause?.segment.delay?.minutes ?? 0)} late, ${cause?.segment.delay?.reason}. That misses ${segment.flightNo} in ${cityOf(segment.from)}.`;
  const who = disruption.protected
    ? `One ticket, so ${segment.airline} owes you a seat.`
    : "Two separate tickets, so the next flight is yours to buy.";
  const date = "date" in event ? event.date : dateOf(segment.dep);

  return (
    <section
      aria-label={disruption.kind === "cancelled" ? "Flight cancelled" : "Connection missed"}
      className="border-caution/30 bg-caution/8 flex flex-col gap-2 rounded-md border p-3"
    >
      <div>
        <p className="text-caution-text text-[14px] leading-5 font-[550]">{title}</p>
        <p className="text-ink-2 text-[13px] leading-[18px]">
          {who} {fixes.length ? "Nothing changes until you pick one." : "No replacement flights yet. Watching for seats."}
        </p>
      </div>
      <ul className="flex flex-col gap-1.5">
        {fixes.map((fix) => (
          <li key={fix.segment.flightNo + fix.segment.dep} className="bg-card flex items-center justify-between gap-3 rounded-sm p-2.5">
            <div className="min-w-0">
              <p className="text-[14px] leading-5 font-[550]">
                {dateOf(fix.segment.dep) === date ? "Same day" : "Next day"} · {fix.segment.airline} {fix.segment.flightNo} at{" "}
                {clockOf(fix.segment.dep)}
              </p>
              <p className="text-ink-2 text-[13px] leading-[18px]">
                Lands {clockOf(fix.segment.arr)}
                {fix.costPerPerson > 0 && ` · ${formatAmount(fix.costPerPerson * people)} for ${people === 1 ? "you" : `${people} people`}`}
              </p>
              <FlagList flags={fix.flags} className="mt-1" />
            </div>
            <Button size="sm" variant="outline" className="rounded-full" onClick={() => onRebook(event.id, fix.segment.flightNo)}>
              {fix.costPerPerson > 0 ? "Buy" : "Switch"}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Money that could move. It never does on its own. */
function ProposalPanel({ proposal, onRefare }: { proposal: Proposal; onRefare: (eventId: string) => void }) {
  return (
    <section
      aria-label="Lower fare found"
      className="border-positive/30 bg-positive/8 flex items-center justify-between gap-3 rounded-md border p-3"
    >
      <div>
        <p className="text-[14px] leading-5 font-[550]">
          Your {proposal.direction === "out" ? "outbound" : "return"} flights now sell for {formatAmount(proposal.drop)} less
        </p>
        <p className="text-ink-2 text-[13px] leading-[18px]">
          After the {formatAmount(proposal.fee)} change fee you keep {formatAmount(proposal.net)}. Same flights, same seats.
        </p>
      </div>
      <Button size="sm" variant="outline" className="rounded-full" onClick={() => onRefare(proposal.event.id)}>
        Take it
      </Button>
    </section>
  );
}

function BoardingPass({ pass }: { pass: Pass }) {
  return (
    <div className="border-line-strong flex flex-col gap-0.5 rounded-md border border-dashed p-3">
      <Meta>
        {pass.flightNo} · {pass.route}
      </Meta>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[15px] leading-[22px] font-[550]">{pass.label}</span>
        <span className="text-[17px] leading-6 font-[550] tabular-nums">{pass.seat}</span>
      </div>
      <span className="text-ink-2 text-[12px] leading-4">
        Boards {pass.boards}
        {pass.gate && ` · Gate ${pass.gate}`}
      </span>
      {pass.delay && <span className="text-caution-text text-[12px] leading-4">{pass.delay}</span>}
      {pass.note && <span className="text-muted-foreground text-[12px] leading-4">{pass.note}</span>}
    </div>
  );
}
