"use client";

import { Field, Meta, Missing } from "@/components/intents/shared";
import { cityOf } from "@/lib/jobs/flight/airports";
import { durationOf, type Flag, layoversOf } from "@/lib/jobs/flight/checks";
import { cheaperDay, type DayPrice, type Option, proofLine, type Results } from "@/lib/jobs/flight/rank";
import { clockOf, dateOf, dayLabel, formatDuration, weekdayLabel } from "@/lib/jobs/flight/time";
import type { Itinerary, Trip, TripRequest } from "@/lib/jobs/flight/types";
import { formatAmount } from "@/lib/parse/common";
import { cn } from "@/lib/utils";
import { FlagList, Suggestion } from "./parts";

const compact = (n: number) => `₹${(n / 1000).toFixed(1)}k`;
const unique = <T,>(items: T[]) => [...new Set(items)];
const joinAnd = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

function describeTrip(trip: Trip) {
  const legs = [trip.out, ...(trip.back ? [trip.back] : [])];
  const airlines = unique(legs.flatMap((it) => it.segments.map((s) => s.airline)));
  const hubs = unique(legs.flatMap((it) => layoversOf(it.segments).map((l) => cityOf(l.at))));
  return `${joinAnd(airlines)}${hubs.length ? ` via ${joinAnd(hubs)}` : " nonstop"}`;
}

/**
 * Three distinct, pre-checked choices plus the proof of how wide the search went. Choosing stays human,
 * because choosing is the work.
 */
export function ChooseStage({
  request,
  found,
  selectedId,
  onSelect,
  onRefine,
}: {
  request: TripRequest & { depart: string };
  found: Results;
  selectedId: string | null;
  onSelect: (optionId: string) => void;
  onRefine: (patch: Partial<TripRequest>) => void;
}) {
  const cheaper = cheaperDay(found, request.depart);
  const people = request.travellers.length;

  return (
    <div className="flex flex-col gap-3">
      <Field index={0}>
        <DateStrip strip={found.strip} selected={request.depart} onPick={(date) => onRefine({ depart: date })} />
      </Field>
      <Field index={1}>
        <Meta>{proofLine(found)}</Meta>
      </Field>
      {found.options.length ? (
        <div className="flex flex-col gap-2">
          {found.options.map((option, i) => (
            <Field key={option.id} index={2 + i}>
              <OptionCard option={option} people={people} selected={option.id === selectedId} onSelect={() => onSelect(option.id)} />
            </Field>
          ))}
        </div>
      ) : (
        <Missing>Nothing fits every rule on this day. Try another day or relax a rule.</Missing>
      )}
      <Field index={5} className="flex flex-wrap gap-2">
        {cheaper && (
          <Suggestion onClick={() => onRefine({ depart: cheaper.date })}>
            Leave {cheaper.label}, save {formatAmount(cheaper.saving)}
          </Suggestion>
        )}
        <Suggestion onClick={() => onRefine({ avoidOvernight: !request.avoidOvernight })}>
          {request.avoidOvernight ? "Allow overnight layovers" : "No overnight layovers"}
        </Suggestion>
        {request.priority !== "balanced" && (
          <Suggestion onClick={() => onRefine({ priority: "balanced" })}>Balance price and time</Suggestion>
        )}
      </Field>
    </div>
  );
}

function DateStrip({ strip, selected, onPick }: { strip: DayPrice[]; selected: string; onPick: (date: string) => void }) {
  const prices = strip.flatMap((d) => (d.total === null ? [] : [d.total]));
  const lowest = prices.length ? Math.min(...prices) : null;
  return (
    <div role="group" aria-label="Departure day" className="grid grid-cols-7 gap-1.5">
      {strip.map((day) => {
        const isSelected = day.date === selected;
        const isLowest = !isSelected && day.total !== null && day.total === lowest;
        return (
          <button
            key={day.date}
            type="button"
            disabled={day.total === null}
            aria-pressed={isSelected}
            aria-label={`${dayLabel(day.date)}, ${day.total === null ? "no fares" : formatAmount(day.total)}${isLowest ? ", lowest" : ""}`}
            onClick={() => onPick(day.date)}
            className={cn(
              "flex flex-col items-center gap-0.5 rounded-sm border px-1 py-1.5 transition-[border-color,background-color,scale] duration-150 ease-out active:scale-[0.97] disabled:opacity-40",
              isSelected
                ? "border-brand bg-brand-soft"
                : isLowest
                  ? "border-positive/40 bg-positive/8"
                  : "border-border hover:border-line-strong",
            )}
          >
            <span className="text-muted-foreground text-[11px] leading-4">{weekdayLabel(day.date)}</span>
            <span className={cn("text-[15px] leading-5 font-[550] tabular-nums", isSelected && "text-brand")}>
              {Number(day.date.slice(8))}
            </span>
            <span
              className={cn(
                "text-[11px] leading-4 tabular-nums",
                isSelected ? "text-brand" : isLowest ? "text-positive" : "text-muted-foreground",
              )}
            >
              {day.total === null ? "–" : compact(day.total)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function LegLine({ label, it }: { label: string; it: Itinerary }) {
  const first = it.segments[0];
  const last = it.segments[it.segments.length - 1];
  const nextDay = dateOf(last.arr) !== dateOf(first.dep);
  return (
    <span className="block">
      <span className="text-muted-foreground">{label}</span> · {clockOf(first.dep)} – {clockOf(last.arr)}
      {nextDay && <sup className="text-muted-foreground ms-0.5 text-[10px]">+1</sup>} · {formatDuration(durationOf(it.segments))} ·{" "}
      {it.ticketing === "single" ? "one ticket" : "two tickets"}
    </span>
  );
}

const spoken = (flags: Flag[]) =>
  flags
    .filter((f) => f.level !== "ok")
    .map((f) => f.text)
    .join(". ");

function OptionCard({ option, people, selected, onSelect }: { option: Option; people: number; selected: boolean; onSelect: () => void }) {
  const { trip } = option;
  const title = describeTrip(trip);
  const warnings = spoken(option.flags);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${option.tag}: ${title}, ${formatAmount(option.total)}.${warnings ? ` ${warnings}.` : " No warnings."}`}
      className={cn(
        "block w-full rounded-md border p-3 text-start transition-[border-color,background-color,scale] duration-150 ease-out active:scale-[0.99]",
        selected ? "border-brand bg-brand-soft" : "border-border bg-card hover:border-line-strong",
      )}
    >
      <span className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="text-muted-foreground block text-[12px] leading-4 font-medium">{option.tag}</span>
          <span className="block text-[15px] leading-[22px] font-[550] text-balance">{title}</span>
        </span>
        <span className="shrink-0 text-end">
          <span className="block text-[17px] leading-6 font-[550] tabular-nums">{formatAmount(option.total)}</span>
          <span className="text-muted-foreground block text-[12px] leading-4">
            {people} {people === 1 ? "person" : "people"}, {trip.back ? "round trip" : "one way"}
          </span>
        </span>
      </span>
      <span className="text-ink-2 mt-2 block text-[13px] leading-[18px] tabular-nums">
        <LegLine label="Out" it={trip.out} />
        {trip.back && <LegLine label="Back" it={trip.back} />}
      </span>
      <FlagList flags={option.flags} className="mt-2" />
    </button>
  );
}
