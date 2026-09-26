import { z } from "zod";
import { APIUserAbortError, classifierMode, warnMockOnce } from "@/lib/jev/client";
import { judgeWithJev } from "@/lib/jobs/flight/jev";
import { judgeOffline, neutralJudgment, type TripJudgment } from "@/lib/jobs/flight/judge";
import { LRU, normalizeKey } from "@/lib/lru";

export const runtime = "nodejs";

const tripRequestSchema = z.object({ text: z.string().max(2000) });
const cache = new LRU<string, TripJudgment>(500);

export async function POST(request: Request) {
  const body = tripRequestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Expected { text: string }" }, { status: 400 });

  const text = body.data.text;
  const key = normalizeKey(text);
  if (key.length < 2) return Response.json(neutralJudgment());

  const hit = cache.get(key);
  if (hit) return Response.json({ ...hit, latencyMs: 0, cached: true } satisfies TripJudgment);

  const { mode, reason } = classifierMode();
  if (mode === "offline") {
    warnMockOnce(reason);
    return Response.json(judgeOffline(text));
  }

  try {
    const judgment = await judgeWithJev(text, request.signal);
    console.info(
      `[jev] ${judgment.model} ${judgment.latencyMs}ms ${judgment.questionCount}q "${key.slice(0, 40)}" → ${judgment.party.value} · ${judgment.followUp.value}`,
    );
    cache.set(key, judgment);
    return Response.json(judgment);
  } catch (err) {
    if (err instanceof APIUserAbortError || request.signal.aborted) {
      return new Response(null, { status: 499 });
    }
    const status = typeof err === "object" && err && "status" in err ? (err as { status: number }).status : undefined;
    console.warn(`[jev] trip call failed${status ? ` (${status})` : ""}: ${err instanceof Error ? err.message : String(err)}`);
    // The client falls back to the offline judge for this keystroke; the UI never flashes.
    return Response.json(neutralJudgment({ error: true, model: "error" }));
  }
}
