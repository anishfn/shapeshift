import { z } from "zod";

export const INTENT_KEYS = [
  "event",
  "reminder",
  "todo",
  "timer",
  "habit",
  "color",
  "split",
  "expense",
  "convert",
  "currency",
  "calc",
  "travel",
  "poll",
  "contact",
  "link",
  "countdown",
  "timezone",
  "random",
  "goal",
  "note",
  "none",
] as const;
export type IntentKey = (typeof INTENT_KEYS)[number];
export type CardIntent = Exclude<IntentKey, "none">;

export const TONES = ["neutral", "positive", "excited", "stressed", "reflective"] as const;
export const EVENT_MODES = ["in_person", "video_call", "phone_call", "unspecified"] as const;
export const TRANSPORTS = ["flight", "train", "bus", "car", "unspecified"] as const;
export const TRIP_TYPES = ["work", "leisure", "unspecified"] as const;
export const EXPENSE_CATEGORIES = [
  "food",
  "transport",
  "shopping",
  "bills",
  "entertainment",
  "health",
  "other",
] as const;
export const COLOR_MOODS = ["warm", "cool", "neutral", "vivid", "pastel", "dark"] as const;
export const TIMER_KINDS = ["countdown", "focus", "break", "stopwatch"] as const;

export type Tone = (typeof TONES)[number];
export type EventMode = (typeof EVENT_MODES)[number];
export type Transport = (typeof TRANSPORTS)[number];
export type TripType = (typeof TRIP_TYPES)[number];
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export type ColorMood = (typeof COLOR_MOODS)[number];
export type TimerKind = (typeof TIMER_KINDS)[number];

function answerSchema<const T extends readonly [string, ...string[]]>(values: T) {
  const e = z.enum(values);
  return z.object({
    value: e,
    confidence: z.number(),
    probabilities: z.partialRecord(e, z.number()),
  });
}

export type Answer<T extends string> = {
  value: T;
  confidence: number;
  probabilities: Partial<Record<T, number>>;
};

export const signalsSchema = z.object({
  isQuestion: z.number(),
  recurring: z.number(),
  urgency: z.object({ score: z.number(), confidence: z.number() }),
  tone: answerSchema(TONES),
  eventMode: answerSchema(EVENT_MODES),
  transport: answerSchema(TRANSPORTS),
  tripType: answerSchema(TRIP_TYPES),
  expenseCategory: answerSchema(EXPENSE_CATEGORIES),
  colorMood: answerSchema(COLOR_MOODS),
  timerKind: answerSchema(TIMER_KINDS),
  hasExplicitOptions: z.number(),
  isShoppingList: z.number(),
});
export type Signals = z.infer<typeof signalsSchema>;
export type SignalKey = keyof Signals;

export const intentResultSchema = z.object({
  intent: answerSchema(INTENT_KEYS),
  readiness: z.number(),
  signals: signalsSchema,
  latencyMs: z.number(),
  questionCount: z.number(),
  model: z.string(),
  cached: z.boolean().optional(),
  error: z.boolean().optional(),
  source: z.enum(["jev", "mock"]).optional(),
});
export type IntentResult = z.infer<typeof intentResultSchema>;

export const intentRequestSchema = z.object({ text: z.string().max(2000) });

function neutralAnswer<T extends string>(value: T): Answer<T> {
  return { value, confidence: 1, probabilities: { [value]: 1 } as Partial<Record<T, number>> };
}

export function neutralSignals(): Signals {
  return {
    isQuestion: 0,
    recurring: 0,
    urgency: { score: 0, confidence: 1 },
    tone: neutralAnswer("neutral"),
    eventMode: neutralAnswer("unspecified"),
    transport: neutralAnswer("unspecified"),
    tripType: neutralAnswer("unspecified"),
    expenseCategory: neutralAnswer("other"),
    colorMood: neutralAnswer("neutral"),
    timerKind: neutralAnswer("countdown"),
    hasExplicitOptions: 0,
    isShoppingList: 0,
  };
}

export function noneResult(extra: Partial<IntentResult> = {}): IntentResult {
  return {
    intent: neutralAnswer("none"),
    readiness: 0,
    signals: neutralSignals(),
    latencyMs: 0,
    questionCount: 0,
    model: "none",
    ...extra,
  };
}
