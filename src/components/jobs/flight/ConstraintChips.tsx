"use client";

import { Accessibility, CalendarRange, Gauge, MoonStar, Plane, Users, Wallet } from "lucide-react";
import { Chip, Field, Placeholder } from "@/components/intents/shared";
import { cityOf } from "@/lib/jobs/flight/airports";
import { labelOf } from "@/lib/jobs/flight/profile";
import { dayLabel } from "@/lib/jobs/flight/time";
import { travellersLabel } from "@/lib/jobs/flight/trip";
import type { Profile, TripRequest } from "@/lib/jobs/flight/types";

/**
 * Everything the sentence was understood to mean, shown before any money moves. This is where a person
 * catches a misreading: a wrong city or a dropped constraint is visible here, not after payment.
 */
export function ConstraintChips({ request, profile }: { request: TripRequest; profile: Profile }) {
  const { origin, destination, depart, back } = request;
  return (
    <Field index={0} className="flex flex-wrap gap-1.5">
      {origin && destination ? (
        <Chip icon={Plane}>
          {cityOf(origin)} {back ? "⇄" : "→"} {cityOf(destination)}
        </Chip>
      ) : (
        <Placeholder>{origin ? "Add destination" : "Add where to"}</Placeholder>
      )}
      {depart ? (
        <Chip icon={CalendarRange}>
          {dayLabel(depart)}
          {back ? ` – ${dayLabel(back)}` : " · one way"}
        </Chip>
      ) : (
        <Placeholder>Add dates</Placeholder>
      )}
      {request.travellers.length ? (
        <Chip icon={Users}>{travellersLabel(request.travellers, profile)}</Chip>
      ) : (
        <Placeholder>Add who is going</Placeholder>
      )}
      {Object.entries(request.assistance).map(([id, need]) =>
        need ? (
          <Chip key={id} icon={Accessibility}>
            Wheelchair for {labelOf(profile, id)}
          </Chip>
        ) : null,
      )}
      {request.avoidOvernight && <Chip icon={MoonStar}>No overnight layovers</Chip>}
      {request.priority !== "balanced" && (
        <Chip icon={request.priority === "cheapest" ? Wallet : Gauge}>
          {request.priority === "cheapest" ? "Cheapest first" : "Fastest first"}
        </Chip>
      )}
    </Field>
  );
}
