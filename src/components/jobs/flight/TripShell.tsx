"use client";

import { CornerDownLeft, Mic, Radio } from "lucide-react";
import { MotionConfig, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Meta } from "@/components/intents/shared";
import { LatencyHud } from "@/components/shapeshift/LatencyHud";
import { Kbd } from "@/components/ui/kbd";
import { useTripDemo } from "@/hooks/useTripDemo";
import { useTripJudgment } from "@/hooks/useTripJudgment";
import { offsetOf } from "@/lib/jobs/flight/airports";
import { DEMO_NOW, HERO_SENTENCE } from "@/lib/jobs/flight/beats";
import { follow, describeFollow } from "@/lib/jobs/flight/follow";
import { hasInventory } from "@/lib/jobs/flight/inventory";
import { DEMO_PROFILE } from "@/lib/jobs/flight/profile";
import { isSearchable } from "@/lib/jobs/flight/rank";
import { say } from "@/lib/jobs/flight/say";
import { dayLabel, MINUTE, wallClock } from "@/lib/jobs/flight/time";
import { describeAction, initialTrip, momentsOf, reduceTrip, stageOf, type TripAction, type TripState } from "@/lib/jobs/flight/trip";
import { cn } from "@/lib/utils";
import { FlightJob, type JobLine } from "./FlightJob";
import { Phones } from "./LabPanels";
import { marksFor, TripClock } from "./TripClock";

const subscribeNoop = () => () => {};

function useSearchFlags() {
  const search = useSyncExternalStore(
    subscribeNoop,
    () => window.location.search,
    () => "",
  );
  return useMemo(() => {
    const p = new URLSearchParams(search);
    return { say: p.get("say") ?? "", demo: p.get("demo") === "1", loop: p.get("loop") === "1", phones: p.get("phones") === "1" };
  }, [search]);
}

/** The most recent thing the card can say happened at `t`. */
function happenedAt(state: TripState, t: number): JobLine {
  const booking = state.booking;
  if (!booking) return { kind: "event", text: "" };
  const done = momentsOf(booking, t).filter((m) => m.status === "done");
  const latest = done.length ? done[done.length - 1].at : t;
  const first = done.find((m) => m.at === latest);
  const w = wallClock(t, offsetOf(booking.trip.out.segments[0].from));
  return { kind: "event", text: `${dayLabel(w.date)} · ${w.clock}${first ? ` · ${first.text}` : ""}` };
}

/**
 * The whole job from one text box. Before Enter the sentence is read live into chips; after Enter the
 * same box takes follow-ups ("the first one, aisle for mom", "take the 14:10 one"). Money moves only on
 * Enter with an empty box at the review, which is the only commit. The clock is the demo's: it starts
 * on the day the trip is planned and jumps forward through the trip.
 */
export function TripShell() {
  const flags = useSearchFlags();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [state, setState] = useState<TripState>(initialTrip);
  const [now, setNow] = useState(DEMO_NOW);
  const [line, setLine] = useState<JobLine>({ kind: "say", text: "" });
  const { judgment, status } = useTripJudgment(text);

  const stage = stageOf(state);
  const trimmed = text.trim();
  const ref = useMemo(() => new Date(now), [now]);
  const draft = useMemo(
    () => (stage === "understand" && trimmed ? say(text, judgment, DEMO_PROFILE, ref) : null),
    [stage, trimmed, text, judgment, ref],
  );
  const actions = useMemo(
    () => (stage !== "understand" && trimmed ? follow(text, judgment, state, DEMO_PROFILE, now) : []),
    [stage, trimmed, text, judgment, state, now],
  );
  const hint = actions.length ? describeFollow(actions, state, DEMO_PROFILE) : null;
  const ready = draft !== null && isSearchable(draft) && hasInventory(draft.origin, draft.destination);

  // ?say=… seeds the box once, the way a link from the main shell arrives.
  const [seeded, setSeeded] = useState("");
  if (flags.say !== seeded) {
    setSeeded(flags.say);
    if (flags.say) setText(flags.say);
  }

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const at = () => new Date(now).toISOString();

  const run = (list: TripAction[], said: JobLine) => {
    setState((s) => list.reduce((acc, action) => reduceTrip(acc, action), s));
    setLine(said);
  };

  /** Enter. Returns false when there was nothing to do with what is in the box. */
  const submit = (): boolean => {
    if (stage === "understand") {
      if (!draft || !ready) return false;
      run([{ type: "understood", request: draft }], { kind: "say", text });
      setText("");
      return true;
    }
    if (!trimmed) {
      if (stage !== "confirm") return false;
      run([{ type: "book", at: at() }], { kind: "enter", text: "Enter" });
      return true;
    }
    if (!actions.length) return false;
    run(actions, { kind: "say", text });
    setText("");
    return true;
  };

  /** Clicks inside the stages are the same actions a sentence would produce. */
  const dispatch = (action: TripAction) => {
    const pressedEnter = action.type === "book" || action.type === "understood";
    run([action], { kind: pressedEnter ? "enter" : "say", text: describeAction(action, state, DEMO_PROFILE) });
  };

  const jump = (t: number) => {
    setNow(t);
    setLine(happenedAt(state, t));
  };

  const reset = () => {
    setText("");
    setState(initialTrip);
    setNow(DEMO_NOW);
    setLine({ kind: "say", text: "" });
  };

  useTripDemo(flags.demo, flags.loop, {
    getText: () => inputRef.current?.value ?? "",
    setText,
    submit,
    jumpTo: (label) => {
      if (!state.booking) return false;
      const mark = marksFor(state.booking).marks.find((m) => m.label === label);
      if (!mark) return false;
      jump(mark.at + MINUTE);
      return true;
    },
    reset,
  });

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (trimmed) setText("");
      else if (stage === "confirm") dispatch({ type: "select", optionId: null });
    }
  };

  const caption = trimmed
    ? stage === "understand"
      ? null
      : hint
        ? { kind: "enter" as const, text: hint }
        : { kind: "say" as const, text: "Not sure what that means yet" }
    : line.text
      ? line
      : null;

  const placeholder =
    stage === "understand"
      ? "Say the whole trip once"
      : stage === "choose"
        ? "the first one, aisle for mom"
        : stage === "confirm"
          ? "Enter books it, or change anything by saying so"
          : "take the 14:10 one";

  return (
    <MotionConfig reducedMotion="user">
      <main id="main" className="mx-auto w-full max-w-[600px] px-4 pt-[10vh] pb-24 sm:px-0 sm:pt-[14vh]">
        <h1 className="sr-only">Flight job</h1>
        <FlightJob
          state={state}
          draft={draft}
          now={now}
          line={line}
          profile={DEMO_PROFILE}
          dispatch={dispatch}
          header={
            <motion.div layout="position" className="flex flex-col px-5 pt-4 pb-2">
              <div className="relative flex h-10 items-center">
                <input
                  ref={inputRef}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder={placeholder}
                  aria-label="Say what you need"
                  aria-describedby="trip-hint"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="done"
                  className="caret-brand text-foreground placeholder:text-muted-foreground/70 relative z-[1] h-8 w-full bg-transparent pe-6 text-[20px] leading-8 font-[450] tracking-[-0.01em] outline-none"
                />
                <span
                  aria-hidden
                  className={cn(
                    "bg-brand absolute end-0 size-1.5 rounded-full transition-opacity duration-300 ease-out",
                    status === "thinking" ? "opacity-60" : "opacity-0",
                  )}
                />
              </div>
              <Caption caption={caption} />
            </motion.div>
          }
          empty={
            <div className="flex flex-col gap-2">
              <Meta>Where, when, who, and anything that matters. It searches, checks, books on Enter, and watches until you land.</Meta>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setText(HERO_SENTENCE)}
                className="text-ink-2 hover:text-foreground self-start text-start text-[14px] leading-5 underline decoration-dotted underline-offset-4"
              >
                “{HERO_SENTENCE}”
              </button>
            </div>
          }
        />
        {state.booking && <TripClock booking={state.booking} now={now} onChange={jump} />}
        {state.booking && flags.phones && <Phones booking={state.booking} now={now} profile={DEMO_PROFILE} />}
        <p id="trip-hint" className="sr-only">
          Type the trip in one sentence. Enter searches, then Enter with an empty box books. Escape clears.
        </p>
      </main>
      <LatencyHud
        latency={judgment.source === "jev" ? judgment.latencyMs : 0}
        questions={judgment.questionCount}
        model={judgment.model}
        cached={Boolean(judgment.cached)}
        large={flags.demo}
      />
    </MotionConfig>
  );
}

/** Under the box: what Enter will do with what is typed, or the last thing that was said or happened. */
function Caption({ caption }: { caption: JobLine | null }) {
  if (!caption) return <div className="h-5" aria-hidden />;
  const Icon = caption.kind === "say" ? Mic : caption.kind === "event" ? Radio : null;
  return (
    <div className="text-muted-foreground flex h-5 items-center gap-1.5 text-[13px] leading-5" aria-live="polite">
      {caption.kind === "enter" ? (
        <Kbd className="h-4 px-1 text-[10px]">
          <CornerDownLeft aria-hidden />
        </Kbd>
      ) : (
        Icon && <Icon className="size-3.5 shrink-0" aria-hidden />
      )}
      <span className="truncate">{caption.text}</span>
    </div>
  );
}
