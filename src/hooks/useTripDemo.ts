"use client";

import { useEffect, useRef } from "react";

/**
 * The demo film for the flight job, typed at human speed. Each step either types a sentence, presses
 * Enter, or jumps the trip clock to a named moment. The script never touches state directly: it goes
 * through the same text box and clock a person would.
 */
export type TripDemoStep =
  { type: "say"; text: string } | { type: "enter" } | { type: "jump"; mark: string } | { type: "wait"; ms: number };

export const TRIP_DEMO_SCRIPT: TripDemoStep[] = [
  { type: "say", text: "kathmandu from bangalore oct 10, back oct 25, me and mom, she needs a wheelchair, no overnight layovers" },
  { type: "wait", ms: 1400 },
  { type: "enter" },
  { type: "wait", ms: 2200 },
  { type: "say", text: "the first one, aisle for mom" },
  { type: "wait", ms: 900 },
  { type: "enter" },
  { type: "wait", ms: 2200 },
  { type: "enter" },
  { type: "wait", ms: 2000 },
  { type: "jump", mark: "Fare" },
  { type: "wait", ms: 2000 },
  { type: "jump", mark: "Check-in" },
  { type: "wait", ms: 2200 },
  { type: "jump", mark: "Cancelled" },
  { type: "wait", ms: 2400 },
  { type: "say", text: "take the 14:10 one" },
  { type: "wait", ms: 800 },
  { type: "enter" },
  { type: "wait", ms: 2000 },
  { type: "jump", mark: "Land" },
  { type: "wait", ms: 1800 },
  { type: "jump", mark: "Delayed" },
  { type: "wait", ms: 2600 },
  { type: "say", text: "take the 20:05 one" },
  { type: "wait", ms: 800 },
  { type: "enter" },
  { type: "wait", ms: 2000 },
  { type: "jump", mark: "Home" },
  { type: "wait", ms: 3000 },
];

export type TripDemoApi = {
  getText: () => string;
  setText: (t: string) => void;
  /** Press Enter; false when there was nothing to submit. */
  submit: () => boolean;
  /** Jump the clock to a named mark; false when there is no such mark yet. */
  jumpTo: (mark: string) => boolean;
  reset: () => void;
};

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const id = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(id);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });

const jitter = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

/** ?demo=1 plays the script; &loop=1 repeats it forever. */
export function useTripDemo(enabled: boolean, loop: boolean, api: TripDemoApi) {
  const apiRef = useRef(api);
  useEffect(() => {
    apiRef.current = api;
  });

  useEffect(() => {
    if (!enabled) return;
    const ctrl = new AbortController();
    const { signal } = ctrl;

    const type = async (s: string) => {
      let current = apiRef.current.getText();
      for (const ch of s) {
        current += ch;
        apiRef.current.setText(current);
        await sleep(ch === " " ? jitter(90, 160) : jitter(35, 75), signal);
      }
    };

    (async () => {
      await sleep(900, signal);
      do {
        apiRef.current.reset();
        await sleep(600, signal);
        for (const step of TRIP_DEMO_SCRIPT) {
          if (step.type === "say") await type(step.text);
          else if (step.type === "wait") await sleep(step.ms, signal);
          else if (step.type === "enter") {
            if (!apiRef.current.submit()) {
              // Jev may still be thinking; give it a beat and try once more before moving on.
              await sleep(500, signal);
              apiRef.current.submit();
            }
          } else if (!apiRef.current.jumpTo(step.mark)) {
            await sleep(500, signal);
            apiRef.current.jumpTo(step.mark);
          }
        }
        if (loop) await sleep(1500, signal);
      } while (loop && !signal.aborted);
    })().catch(() => {});

    return () => ctrl.abort();
  }, [enabled, loop]);

  // Hide the cursor after 2s idle so recordings stay clean.
  useEffect(() => {
    if (!enabled) return;
    let id: ReturnType<typeof setTimeout>;
    const wake = () => {
      document.body.classList.remove("demo-idle");
      clearTimeout(id);
      id = setTimeout(() => document.body.classList.add("demo-idle"), 2000);
    };
    wake();
    window.addEventListener("mousemove", wake);
    return () => {
      clearTimeout(id);
      window.removeEventListener("mousemove", wake);
      document.body.classList.remove("demo-idle");
    };
  }, [enabled]);
}
