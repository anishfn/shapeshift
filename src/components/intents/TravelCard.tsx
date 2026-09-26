"use client";

import { ArrowRight, CalendarRange, PlaneTakeoff } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { DateRange } from "react-day-picker";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { TravelData } from "@/lib/parse/travel";
import { TRANSPORT_ICON } from "./icons";
import { Chip, Field, IconSwap, Meta, Placeholder } from "./shared";
import type { CardProps } from "./types";

const short = (d: Date) => d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const spoken = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toLowerCase();

/** The card's reading of the text, said back as one sentence the flight job can start from. */
function sentenceFor(data: TravelData, from: Date | undefined, to: Date | undefined): string {
  const parts = [data.destination?.toLowerCase(), data.origin && `from ${data.origin.toLowerCase()}`, from && spoken(from)];
  const back = to && from && to.getTime() !== from.getTime() ? `back ${spoken(to)}` : null;
  return [parts.filter(Boolean).join(" "), back].filter(Boolean).join(", ");
}

export function TravelCard({ data, signals, interactive }: CardProps<TravelData>) {
  const [range, setRange] = useState<DateRange | undefined>(undefined);
  const from = range?.from ?? data.start ?? undefined;
  const to = range ? range.to : (data.end ?? undefined);
  const Icon = TRANSPORT_ICON[signals.transport ?? "unspecified"];

  return (
    <div className="flex flex-col gap-3">
      <Field index={0} className="flex items-center gap-3">
        <span className="bg-secondary text-ink-2 grid size-10 shrink-0 place-items-center rounded-md">
          <IconSwap icon={Icon} iconClassName="size-5" />
        </span>
        <div className="flex min-w-0 flex-col">
          {data.destination ? (
            <h2 className="flex flex-wrap items-center gap-x-2 text-[17px] leading-6 font-[550]">
              {data.origin && (
                <>
                  <span className="text-ink-2">{data.origin}</span>
                  <ArrowRight className="text-muted-foreground size-4" aria-hidden />
                </>
              )}
              {data.destination}
            </h2>
          ) : (
            <Placeholder insert=" to ">Add destination</Placeholder>
          )}
          {signals.transport && <Meta className="capitalize">{signals.transport === "car" ? "Road trip" : signals.transport}</Meta>}
        </div>
      </Field>
      <Field index={1}>
        <Popover>
          <PopoverTrigger asChild disabled={!interactive}>
            <button
              type="button"
              aria-label={from ? "Change dates" : "Add dates"}
              className="focus-visible:outline-ring rounded-full focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              {from ? (
                <Chip icon={CalendarRange}>
                  {short(from)}
                  {to && to.getTime() !== from.getTime() ? ` – ${short(to)}` : ""}
                </Chip>
              ) : (
                <Placeholder>Add dates</Placeholder>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar mode="range" selected={{ from, to }} onSelect={setRange} numberOfMonths={1} />
          </PopoverContent>
        </Popover>
      </Field>
      {data.destination && (signals.transport === "flight" || signals.transport === null) && (
        <Field index={2}>
          <Link
            href={`/trip?say=${encodeURIComponent(sentenceFor(data, from, to))}`}
            tabIndex={interactive ? 0 : -1}
            className="border-line-strong text-muted-foreground hover:border-muted-foreground hover:text-ink-2 focus-visible:outline-ring inline-flex h-7 items-center gap-1 rounded-full border border-dashed px-2.5 text-[13px] font-medium whitespace-nowrap transition-[border-color,color,scale] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 active:scale-[0.96]"
          >
            <PlaneTakeoff className="size-3.5" aria-hidden />
            Book the whole trip
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </Field>
      )}
    </div>
  );
}
