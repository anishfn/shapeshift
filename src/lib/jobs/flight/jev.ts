import "server-only";
import { getClient } from "@/lib/jev/client";
import type { Answer } from "@/lib/jev/types";
import type { TripJudgment } from "./judge";
import { TRIP_QUESTION_COUNT, tripQuestions } from "./questions";

function answer<T extends string>(r: { choice: T; confidence: number; probabilities: { readonly [k in T]: number } }): Answer<T> {
  return { value: r.choice, confidence: r.confidence, probabilities: { ...r.probabilities } as Partial<Record<T, number>> };
}

/** One call, every trip question in parallel. Throws on network / API errors so the route can fall back. */
export async function judgeWithJev(text: string, signal?: AbortSignal): Promise<TripJudgment> {
  const started = performance.now();
  const res = await getClient().systemOne({ state: { text }, questions: tripQuestions }, { signal });
  const latencyMs = Math.round(performance.now() - started);
  const a = res.answers;

  return {
    wantsFlight: a.wantsFlight.noul,
    party: answer(a.party),
    assistanceFor: answer(a.assistanceFor),
    avoidsOvernight: a.avoidsOvernight.noul,
    priority: answer(a.priority),
    followUp: answer(a.followUp),
    optionPick: answer(a.optionPick),
    latencyMs,
    questionCount: TRIP_QUESTION_COUNT,
    model: res.model,
    source: "jev",
  };
}
