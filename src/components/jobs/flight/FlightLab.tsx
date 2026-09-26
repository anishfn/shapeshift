"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { offsetOf } from "@/lib/jobs/flight/airports";
import { BEATS, type Beat } from "@/lib/jobs/flight/beats";
import { DEMO_PROFILE } from "@/lib/jobs/flight/profile";
import { dayLabel, wallClock } from "@/lib/jobs/flight/time";
import { describeAction, phaseOf, phasesFor, reduceTrip, stageOf, type TripAction } from "@/lib/jobs/flight/trip";
import { cn } from "@/lib/utils";
import { FlightJob, type JobLine } from "./FlightJob";
import { Phones, WhatIf } from "./LabPanels";
import { TripClock } from "./TripClock";

/**
 * A workbench for the flight job. Step through the demo beats, click anything to drive the real
 * reducer, and drag the trip clock to watch the booked card change shape.
 */
export function FlightLab() {
  const [index, setIndex] = useState(0);
  const beat = BEATS[index];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable]")) return;
      if (e.key === "ArrowRight") setIndex((i) => Math.min(BEATS.length - 1, i + 1));
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <main id="main" className="mx-auto w-full max-w-[600px] px-4 pt-12 pb-24 sm:px-0 sm:pt-16">
      <header className="mb-5 flex flex-col gap-1">
        <h1 className="text-[17px] leading-6 font-[550]">Flight job lab</h1>
        <p className="text-ink-2 text-[14px] leading-5">
          One sentence to back home, in {BEATS.length} beats: a fare watched, a cancellation, a fog delay that breaks a connection. Click
          anything to drive the real state machine. Demo inventory: nothing is booked or charged.
        </p>
      </header>

      <nav aria-label="Demo beats" className="mb-4 flex flex-wrap items-center gap-1.5">
        {BEATS.map((b, i) => (
          <button
            key={b.id}
            type="button"
            aria-current={i === index ? "step" : undefined}
            onClick={() => setIndex(i)}
            className={cn(
              "focus-visible:outline-ring inline-flex h-7 items-center rounded-full px-2.5 text-[13px] font-medium transition-[background-color,color,scale] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 active:scale-[0.96]",
              i === index ? "bg-primary text-primary-foreground" : "bg-secondary text-ink-2 hover:text-foreground",
            )}
          >
            <span className="me-1 tabular-nums opacity-60">{i + 1}</span>
            {b.label}
          </button>
        ))}
        <span className="ms-auto flex items-center gap-1">
          <Button size="icon-sm" variant="ghost" aria-label="Previous beat" disabled={index === 0} onClick={() => setIndex(index - 1)}>
            <ChevronLeft />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Next beat"
            disabled={index === BEATS.length - 1}
            onClick={() => setIndex(index + 1)}
          >
            <ChevronRight />
          </Button>
        </span>
      </nav>

      {/* Keyed by beat: stepping to a beat always starts from its fixture. */}
      <BeatRunner key={beat.id} beat={beat} />
    </main>
  );
}

function BeatRunner({ beat }: { beat: Beat }) {
  const [state, setState] = useState(beat.state);
  const [now, setNow] = useState(beat.now);
  const [line, setLine] = useState<JobLine>(beat.line);

  const dispatch = (action: TripAction) => {
    const pressedEnter = action.type === "book" || action.type === "understood";
    setLine({ kind: pressedEnter ? "enter" : "say", text: describeAction(action, state, DEMO_PROFILE) });
    setState(reduceTrip(state, action));
  };

  const scrub = (t: number) => {
    setNow(t);
    const { booking } = state;
    if (!booking) return;
    const origin = booking.trip.out.segments[0].from;
    const w = wallClock(t, offsetOf(origin));
    const phase = phasesFor(booking).find((p) => p.id === phaseOf(booking, t));
    setLine({ kind: "event", text: `${dayLabel(w.date)} · ${w.clock} · ${phase?.label ?? ""}` });
  };

  return (
    <>
      <FlightJob state={state} draft={beat.draft} now={now} line={line} profile={DEMO_PROFILE} dispatch={dispatch} />
      {state.booking && <TripClock booking={state.booking} now={now} onChange={scrub} />}
      {state.booking && <Phones booking={state.booking} now={now} profile={DEMO_PROFILE} />}
      {state.booking && state.request && <WhatIf request={state.request} booking={state.booking} />}
      <details className="border-border bg-card text-ink-2 mt-4 rounded-xl border px-4 py-3 text-[13px]">
        <summary className="cursor-pointer font-medium">State · {stageOf(state)}</summary>
        <pre className="mt-3 max-h-80 overflow-auto font-mono text-[11px] leading-4 whitespace-pre-wrap">
          {JSON.stringify({ now: new Date(now).toISOString(), ...state }, null, 2)}
        </pre>
      </details>
    </>
  );
}
