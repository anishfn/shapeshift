"use client";

import { CornerDownLeft, Mic, Radio } from "lucide-react";
import { AnimatePresence, motion, useMotionValue, useReducedMotion } from "motion/react";
import { type ReactNode, useMemo } from "react";
import { Field, Meta } from "@/components/intents/shared";
import { GhostPreview } from "@/components/shapeshift/GhostPreview";
import { MorphContainer } from "@/components/shapeshift/MorphContainer";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { airlinesOn, hasInventory } from "@/lib/jobs/flight/inventory";
import { isSearchable, results, WINDOW_DAYS } from "@/lib/jobs/flight/rank";
import { dayLabel } from "@/lib/jobs/flight/time";
import { disruptionAt, selectedOption, type Stage, stageOf, type TripAction, type TripState } from "@/lib/jobs/flight/trip";
import type { Profile, TripRequest } from "@/lib/jobs/flight/types";
import { spring, tween } from "@/lib/motion";
import { ChooseStage } from "./ChooseStage";
import { ConstraintChips } from "./ConstraintChips";
import { StepRail } from "./parts";
import { ReviewStage } from "./ReviewStage";
import { TripCard } from "./TripCard";

export type JobLine = { kind: "say" | "event" | "enter"; text: string };

const STAGE_STEPS: { id: Stage; label: string }[] = [
  { id: "understand", label: "Understand" },
  { id: "choose", label: "Choose" },
  { id: "confirm", label: "Confirm" },
  { id: "trip", label: "Trip" },
];

/**
 * The flight job inside the Shapeshift shell. One surface for the whole job: the top row is what was
 * said (or what happened), the chips are what was understood, and the body is whatever this stage needs.
 */
export function FlightJob({
  state,
  draft,
  now,
  line,
  profile,
  dispatch,
  header,
  empty,
}: {
  state: TripState;
  /** A live reading of the text box that has not been committed yet. */
  draft: TripRequest | null;
  now: number;
  line: JobLine;
  profile: Profile;
  dispatch: (action: TripAction) => void;
  /** A real text box in place of the line that stands in for it. */
  header?: ReactNode;
  /** What to show before anything has been said. */
  empty?: ReactNode;
}) {
  const reduce = useReducedMotion();
  const readiness = useMotionValue(1);
  const stage = stageOf(state);
  const request = state.request ?? draft;
  const found = useMemo(() => (state.request ? results(state.request) : null), [state.request]);
  const option = useMemo(() => selectedOption(state), [state]);
  const disruption = state.booking ? disruptionAt(state.booking, now) : null;
  const at = new Date(now).toISOString();

  return (
    <MorphContainer readiness={readiness} edge={disruption ? "var(--caution)" : null}>
      {header ?? <LineRow line={line} />}
      <div className="flex flex-col gap-4 px-5 pt-1 pb-5">
        {request && <ConstraintChips request={request} profile={profile} />}
        {stage === "understand" && !draft && empty}

        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={stage}
            layout="position"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={
              reduce ? { opacity: 0, transition: tween.exit } : { opacity: 0, scale: 0.98, filter: "blur(4px)", transition: tween.exit }
            }
            transition={reduce ? tween.fade : { ...spring.settle, delay: 0.04 }}
          >
            {stage === "understand" && draft && (
              <UnderstandStage draft={draft} onSearch={() => dispatch({ type: "understood", request: draft })} />
            )}
            {stage === "choose" && state.request?.depart && found && (
              <ChooseStage
                request={{ ...state.request, depart: state.request.depart }}
                found={found}
                selectedId={state.selectedId}
                onSelect={(optionId) => dispatch({ type: "select", optionId })}
                onRefine={(patch) => dispatch({ type: "refine", patch })}
              />
            )}
            {stage === "confirm" && state.request && option && (
              <ReviewStage
                option={option}
                request={state.request}
                profile={profile}
                seatPrefs={state.seatPrefs}
                onBook={() => dispatch({ type: "book", at })}
                onBack={() => dispatch({ type: "select", optionId: null })}
                onSeatPref={(travellerId, pref) => dispatch({ type: "seat_pref", travellerId, pref })}
              />
            )}
            {stage === "trip" && state.booking && (
              <TripCard
                booking={state.booking}
                now={now}
                profile={profile}
                onRebook={(eventId, flightNo) => dispatch({ type: "rebook", eventId, flightNo, at })}
                onRefare={(eventId) => dispatch({ type: "refare", eventId, at })}
              />
            )}
          </motion.div>
        </AnimatePresence>

        <motion.div layout="position" className="border-border/70 border-t pt-3">
          <StepRail steps={STAGE_STEPS} current={stage} label="Booking progress" />
        </motion.div>
      </div>
    </MorphContainer>
  );
}

/** Stands in for the text box: what was said, or what happened in the world. */
function LineRow({ line }: { line: JobLine }) {
  const Icon = line.kind === "say" ? Mic : Radio;
  return (
    <motion.div layout="position" className="flex min-h-[72px] items-center gap-3 px-5 py-4">
      {line.kind === "enter" ? (
        <span className="text-ink-2 flex items-center gap-2 text-[15px]">
          <Kbd>
            Enter
            <CornerDownLeft aria-hidden />
          </Kbd>
          pressed
        </span>
      ) : (
        <>
          <Icon className="text-muted-foreground size-4 shrink-0" aria-hidden />
          <p className={line.kind === "say" ? "text-foreground text-[17px] leading-6 font-[450]" : "text-ink-2 text-[14px] leading-5"}>
            <span className="sr-only">{line.kind === "say" ? "You said: " : "Update: "}</span>
            {line.text}
          </p>
        </>
      )}
    </motion.div>
  );
}

/** Before Enter: the chips are live and the results show as a faint preview of what Enter will commit. */
function UnderstandStage({ draft, onSearch }: { draft: TripRequest; onSearch: () => void }) {
  const searchable = isSearchable(draft);
  const covered = searchable && hasInventory(draft.origin, draft.destination);
  const preview = useMemo(() => (covered ? results(draft) : null), [covered, draft]);
  const airlines = covered
    ? new Set([...airlinesOn(draft.origin, draft.destination), ...(draft.back ? airlinesOn(draft.destination, draft.origin) : [])]).size
    : 0;

  return (
    <div className="flex flex-col gap-3">
      <Field index={0} className="flex flex-wrap items-center justify-between gap-3">
        <Meta>
          {!searchable
            ? "Say where and when to go"
            : covered
              ? `Enter searches ${2 * WINDOW_DAYS + 1} days around ${dayLabel(draft.depart)} on ${airlines} airlines`
              : "No demo fares for this route yet"}
        </Meta>
        <Button size="sm" onClick={onSearch} disabled={!covered} className="gap-1.5 rounded-full pr-2 pl-3">
          Search
          <CornerDownLeft className="size-3.5 opacity-60" aria-hidden />
        </Button>
      </Field>
      {preview && draft.depart && (
        <GhostPreview ghost>
          <ChooseStage
            request={{ ...draft, depart: draft.depart }}
            found={preview}
            selectedId={null}
            onSelect={() => {}}
            onRefine={() => {}}
          />
        </GhostPreview>
      )}
    </div>
  );
}
