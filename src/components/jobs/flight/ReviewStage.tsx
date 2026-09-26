"use client";

import { ArrowLeft, Fingerprint } from "lucide-react";
import type { ReactNode } from "react";
import { Field, Meta } from "@/components/intents/shared";
import { Button } from "@/components/ui/button";
import { cityOf } from "@/lib/jobs/flight/airports";
import { labelOf, travellerOf } from "@/lib/jobs/flight/profile";
import type { Option } from "@/lib/jobs/flight/rank";
import { clockOf, dateOf, dayLabel } from "@/lib/jobs/flight/time";
import { seatsOn } from "@/lib/jobs/flight/trip";
import type { Itinerary, Profile, SeatPref, TripRequest } from "@/lib/jobs/flight/types";
import { formatAmount } from "@/lib/parse/common";
import { FlagLine, FlagList, Suggestion } from "./parts";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-border/70 grid grid-cols-[88px_minmax(0,1fr)] gap-3 border-b py-2 last:border-b-0">
      <dt className="text-muted-foreground text-[13px] leading-5">{label}</dt>
      <dd className="text-foreground text-[14px] leading-5">{children}</dd>
    </div>
  );
}

const flights = (it: Itinerary) => it.segments.map((s) => `${s.from} ${clockOf(s.dep)} – ${s.to} ${clockOf(s.arr)}`).join(" · ");

/**
 * Every decision already made, on one screen, as defaults you can change by saying so. The book button
 * is the only commit in the whole job.
 */
export function ReviewStage({
  option,
  request,
  profile,
  seatPrefs,
  onBook,
  onBack,
  onSeatPref,
}: {
  option: Option;
  request: TripRequest;
  profile: Profile;
  seatPrefs: Partial<Record<string, SeatPref>>;
  onBook: () => void;
  onBack: () => void;
  onSeatPref: (travellerId: string, pref: SeatPref) => void;
}) {
  const { trip } = option;
  const people = request.travellers;
  const seats = seatsOn({ travellers: people, assistance: request.assistance, seatPrefs }, trip.out.segments[0]);
  const flightCount = trip.out.segments.length + (trip.back?.segments.length ?? 0);
  const bagsThrough = trip.out.ticketing === "single" && (!trip.back || trip.back.ticketing === "single");
  const hub = cityOf(trip.out.segments[0].to);
  const warnings = option.flags.filter((f) => f.level !== "ok");
  const missingIds = people.filter((id) => !travellerOf(profile, id)?.idOnFile);
  const myPref = seatPrefs.me;

  return (
    <div className="flex flex-col gap-3">
      <Field index={0}>
        <dl>
          <Row label="Out">
            <span className="text-ink-2 block">{dayLabel(dateOf(trip.out.segments[0].dep))}</span>
            {flights(trip.out)}
          </Row>
          {trip.back && (
            <Row label="Back">
              <span className="text-ink-2 block">{dayLabel(dateOf(trip.back.segments[0].dep))}</span>
              {flights(trip.back)}
            </Row>
          )}
          <Row label="Travellers">
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {people.map((id) => labelOf(profile, id)).join(" and ")}
              {missingIds.length ? (
                <FlagLine
                  flag={{ kind: "documents", level: "warn", text: `Add ID for ${missingIds.map((id) => labelOf(profile, id)).join(", ")}` }}
                />
              ) : (
                <FlagLine flag={{ kind: "documents", level: "ok", text: "IDs on file" }} />
              )}
            </span>
          </Row>
          <Row label="Seats">
            {people.map((id) => `${labelOf(profile, id)} ${seats[id]}${seatPrefs[id] ? ` · ${seatPrefs[id]}` : ""}`).join(", ")}
          </Row>
          {Object.entries(request.assistance).map(([id, need]) =>
            need ? (
              <Row key={id} label="Assistance">
                Wheelchair for {labelOf(profile, id)} on all {flightCount} flights
              </Row>
            ) : null,
          )}
          <Row label="Bags">
            {bagsThrough ? (
              `1 checked bag each, through to ${cityOf(trip.out.segments[trip.out.segments.length - 1].to)}`
            ) : (
              <FlagLine flag={{ kind: "recheck_bags", level: "warn", text: `Re-check bags in ${hub}` }} />
            )}
          </Row>
          <Row label="Rules">
            {!trip.back || trip.back.rules === trip.out.rules ? trip.out.rules : `Out: ${trip.out.rules}. Back: ${trip.back.rules}.`}
          </Row>
        </dl>
      </Field>

      {warnings.length > 0 && (
        <Field index={1}>
          <FlagList flags={warnings} />
        </Field>
      )}

      <Field index={2} className="flex flex-wrap gap-2">
        <Suggestion onClick={() => onSeatPref("me", myPref === "window" ? "aisle" : "window")}>
          {myPref === "window" ? "Aisle for you" : "Window for you"}
        </Suggestion>
      </Field>

      <Field index={3} className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <div className="flex flex-col">
          <span className="text-[17px] leading-6 font-[550] tabular-nums">Total {formatAmount(option.total)}</span>
          <Meta>{profile.payment} · demo, nothing is charged</Meta>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onBack} className="gap-1 rounded-full">
            <ArrowLeft className="size-3.5" aria-hidden />
            Options
          </Button>
          <Button size="sm" onClick={onBook} className="gap-1.5 rounded-full pr-3 pl-3">
            <Fingerprint className="size-4" aria-hidden />
            Book with Face ID
          </Button>
        </div>
      </Field>
    </div>
  );
}
