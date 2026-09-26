"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { judgeOffline, neutralJudgment, type TripJudgment, tripJudgmentSchema } from "@/lib/jobs/flight/judge";
import { LRU, normalizeKey } from "@/lib/lru";

export type TripJudgmentStatus = "idle" | "thinking" | "ready";

export type TripJudgmentState = {
  judgment: TripJudgment;
  /** The text `judgment` was computed for: always the current text, so `say(judgedText, judgment)` never mixes versions. */
  judgedText: string;
  status: TripJudgmentStatus;
};

const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK === "true";
const clientCache = new LRU<string, TripJudgment>(300);

type Settled = { judgment: TripJudgment; text: string };

/** Ask the server. Any failure or odd reply becomes the offline judgment; only an abort propagates. */
async function judgeRemote(text: string, signal: AbortSignal): Promise<TripJudgment> {
  let res: Response;
  try {
    res = await fetch("/api/trip", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      signal,
    });
  } catch (err) {
    if (signal.aborted) throw err;
    return judgeOffline(text);
  }
  if (!res.ok) return judgeOffline(text);
  const parsed = tripJudgmentSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success || parsed.data.error) return judgeOffline(text);
  return parsed.data;
}

/**
 * Debounced, abortable, stale-safe judgment of the text box. Until Jev answers, the offline judge's
 * reading of the same text is returned, so the UI never waits on the network to show something.
 */
export function useTripJudgment(text: string, { debounceMs = 120 }: { debounceMs?: number } = {}): TripJudgmentState {
  const [settled, setSettled] = useState<Settled | null>(null);
  const reqId = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const key = normalizeKey(text);
  const provisional = useMemo(() => (key.length < 2 ? neutralJudgment() : judgeOffline(text)), [key, text]);

  useEffect(() => {
    const id = ++reqId.current;
    controller.current?.abort();
    if (key.length < 2) return;

    const cached = USE_MOCK ? judgeOffline(text) : clientCache.get(key);
    if (cached) {
      // Nothing to wait for; settle on the next frame.
      const raf = requestAnimationFrame(() => {
        if (id === reqId.current) setSettled({ judgment: USE_MOCK ? cached : { ...cached, cached: true }, text });
      });
      return () => cancelAnimationFrame(raf);
    }

    const timer = setTimeout(async () => {
      const ctrl = new AbortController();
      controller.current = ctrl;
      try {
        const judgment = await judgeRemote(text, ctrl.signal);
        if (id !== reqId.current) return; // stale
        if (judgment.source === "jev") clientCache.set(key, judgment);
        setSettled({ judgment, text });
      } catch {
        // aborted — a newer request owns the state
      }
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [key, text, debounceMs]);

  useEffect(() => () => controller.current?.abort(), []);

  if (settled && settled.text === text) return { judgment: settled.judgment, judgedText: text, status: "ready" };
  return { judgment: provisional, judgedText: text, status: key.length < 2 ? "idle" : "thinking" };
}
