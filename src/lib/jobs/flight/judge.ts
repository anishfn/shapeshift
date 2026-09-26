import { z } from "zod";
import type { Answer } from "@/lib/jev/types";
import { findDate } from "@/lib/parse/common";
import { findAirportsIn } from "./airports";
import { findTravellersIn } from "./profile";

/**
 * What Jev is asked to judge about a sentence, and an offline stand-in that answers the same
 * questions with regexes. Values (cities, dates, names, times) are never in here: `say` and `follow`
 * read those with code. The judgment only settles what code cannot: who is going, who needs help,
 * what matters, what a mid-booking sentence is for.
 */

export const PARTIES = ["self", "self_and_others", "others_only", "unspecified"] as const;
export const ASSISTANCE_FOR = ["nobody", "self", "companion", "everyone"] as const;
export const JUDGED_PRIORITIES = ["cheapest", "fastest", "balanced"] as const;
export const FOLLOW_UPS = ["pick_option", "change_day", "seat", "relax_rule", "go_back", "book", "take_fix", "other"] as const;
export const OPTION_PICKS = ["first", "second", "third", "cheapest", "fastest", "balanced", "none"] as const;

export type Party = (typeof PARTIES)[number];
export type AssistanceFor = (typeof ASSISTANCE_FOR)[number];
export type JudgedPriority = (typeof JUDGED_PRIORITIES)[number];
export type FollowUp = (typeof FOLLOW_UPS)[number];
export type OptionPick = (typeof OPTION_PICKS)[number];

export type TripJudgment = {
  wantsFlight: number;
  party: Answer<Party>;
  assistanceFor: Answer<AssistanceFor>;
  avoidsOvernight: number;
  priority: Answer<JudgedPriority>;
  followUp: Answer<FollowUp>;
  optionPick: Answer<OptionPick>;
  latencyMs: number;
  questionCount: number;
  model: string;
  source: "jev" | "mock";
  cached?: boolean;
  error?: boolean;
};

function answerSchema<const T extends readonly [string, ...string[]]>(values: T) {
  const e = z.enum(values);
  return z.object({ value: e, confidence: z.number(), probabilities: z.partialRecord(e, z.number()) });
}

export const tripJudgmentSchema = z.object({
  wantsFlight: z.number(),
  party: answerSchema(PARTIES),
  assistanceFor: answerSchema(ASSISTANCE_FOR),
  avoidsOvernight: z.number(),
  priority: answerSchema(JUDGED_PRIORITIES),
  followUp: answerSchema(FOLLOW_UPS),
  optionPick: answerSchema(OPTION_PICKS),
  latencyMs: z.number(),
  questionCount: z.number(),
  model: z.string(),
  source: z.enum(["jev", "mock"]),
  cached: z.boolean().optional(),
  error: z.boolean().optional(),
});

export const OFFLINE_MODEL = "jev-offline";
/** Keep in sync with questions.ts (asserted in tests). Not imported from there so the browser never loads the SDK. */
export const OFFLINE_QUESTION_COUNT = 7;

function neutralAnswer<T extends string>(value: T): Answer<T> {
  return { value, confidence: 1, probabilities: { [value]: 1 } as Partial<Record<T, number>> };
}

/** No opinion about anything. What the UI starts from, and what an API error returns. */
export function neutralJudgment(extra: Partial<TripJudgment> = {}): TripJudgment {
  return {
    wantsFlight: 0,
    party: neutralAnswer("unspecified"),
    assistanceFor: neutralAnswer("nobody"),
    avoidsOvernight: 0,
    priority: neutralAnswer("balanced"),
    followUp: neutralAnswer("other"),
    optionPick: neutralAnswer("none"),
    latencyMs: 0,
    questionCount: 0,
    model: "none",
    source: "mock",
    ...extra,
  };
}

// ── Words the deterministic parsers and the offline judge agree on ───────────

/** "no overnight layovers", "avoid red-eyes", "not through the night". */
export const OVERNIGHT_RULE = /\b(no|avoid|without|not|skip)\b.{0,12}\b(overnight|red[- ]?eyes?|night)\b/;
export const CHEAPEST_WORDS = /\b(cheap|cheapest|cheaper|budget|lowest)\b/;
export const FASTEST_WORDS = /\b(fast|fastest|faster|quick|quickest|shortest|direct|non-?stop)\b/;
export const WHEELCHAIR_WORDS = /\b(wheel ?chairs?|mobility assistance|can'?t walk far)\b/;
/** "14:10", "6.40", "7am", "2 pm". */
export const CLOCK_WORDS = /\b\d{1,2}[:.]\d{2}\b|\b\d{1,2}\s*(am|pm)\b/;
/** Signs that the writer is on the trip. "my" is left out: "my mom to goa" books mom. */
export const FIRST_PERSON = /\b(i|me|we|us|myself)\b/;
const DAY_WORDS = /\b(mon|tues?|wed|thu|thurs?|fri|sat|sun)[a-z]*\b|\b(tomorrow|today)\b|\b\d{1,2}(st|nd|rd|th)\b/;

function pick<T extends string>(values: readonly T[], value: T, confidence: number): Answer<T> {
  const rest = (1 - confidence) / Math.max(1, values.length - 1);
  const probabilities = Object.fromEntries(values.map((v) => [v, v === value ? confidence : rest])) as Record<T, number>;
  return { value, confidence, probabilities };
}

/** The first rule that fires wins with the same confidence the offline intent classifier uses. */
function choose<T extends string>(values: readonly T[], rules: [boolean, T][], fallback: T): Answer<T> {
  for (const [hit, v] of rules) if (hit) return pick(values, v, 0.86);
  return pick(values, fallback, 0.74);
}

/** A calendar date in the text, ignoring bare clock times like "the 14:10 one". */
const hasDate = (t: string) => {
  const d = findDate(t);
  return d !== null && !CLOCK_WORDS.test(d.text.trim()) && !/^\d{1,2}(:\d{2})?\s*(am|pm)?$/.test(d.text.trim());
};

/**
 * Regex heuristics that answer the Jev questions offline. Good enough to drive the demo without a key
 * and to stand in for the first 100ms while Jev thinks.
 */
export function judgeOffline(text: string): TripJudgment {
  const t = text.toLowerCase().replace(/[’‘]/g, "'").trim();
  const airports = findAirportsIn(t);
  const travellers = findTravellersIn(t);
  const hasMe = travellers.includes("me");
  const others = travellers.filter((id) => id !== "me");
  const firstPerson = FIRST_PERSON.test(t);
  const plural = /\b(we|us)\b/.test(t);
  // "with mom" puts the writer on the trip even when they never say "me".
  const withOthers = others.length > 0 && /\bwith\b/.test(t);

  const flightWords = /\b(flights?|fly|flying|book|trip|round[- ]trip|one[- ]way)\b/.test(t) || /\bto [a-z]+ from\b/.test(t);
  const wantsFlight = flightWords || airports.length >= 2 ? 0.9 : airports.length === 1 ? 0.6 : 0.08;

  const party = choose<Party>(
    PARTIES,
    [
      [others.length > 0 && !hasMe && !firstPerson && !withOthers, "others_only"],
      [(hasMe || plural || withOthers) && (others.length > 0 || /\bwith\b/.test(t)), "self_and_others"],
      [hasMe || firstPerson, "self"],
    ],
    "unspecified",
  );

  const wheelchair = WHEELCHAIR_WORDS.test(t);
  const assistanceFor = choose<AssistanceFor>(
    ASSISTANCE_FOR,
    [
      [!wheelchair, "nobody"],
      [/\b(we both|both of us|both need|everyone|all of us|each of us|we all)\b/.test(t), "everyone"],
      [
        /\b(i|me|myself)\b[^,.;]{0,24}\b(wheel|mobility|walk)/.test(t) ||
          /\b(wheel ?chairs?|mobility assistance)\b[^,.;]{0,12}\bfor (me|myself)\b/.test(t),
        "self",
      ],
      [/\b(she|he|they|her|him|them)\b/.test(t) || others.length > 0, "companion"],
    ],
    "self",
  );

  const avoidsOvernight = OVERNIGHT_RULE.test(t) ? 0.9 : 0.08;

  const priority = choose<JudgedPriority>(
    JUDGED_PRIORITIES,
    [
      [CHEAPEST_WORDS.test(t), "cheapest"],
      [FASTEST_WORDS.test(t), "fastest"],
    ],
    "balanced",
  );

  const followUp = choose<FollowUp>(
    FOLLOW_UPS,
    [
      [/\b(take|switch|move)\b/.test(t) || (/\bone\b/.test(t) && CLOCK_WORDS.test(t)), "take_fix"],
      [/\b(book|pay|confirm|go ahead|do it|yes)\b/.test(t), "book"],
      // "back" on its own or "back to …", never the "back oct 25" of a return date.
      [/\b(go back|back to|other options|options again|show (me )?(the )?options)\b/.test(t) || t === "back", "go_back"],
      [/\b(aisle|window|middle)\b/.test(t), "seat"],
      [
        /\b(instead|leave|go|depart)\b.*\b(mon|tues?|wed|thu|thurs?|fri|sat|sun)[a-z]*\b|\b(instead|leave|go|depart)\b.*\b(tomorrow|\d{1,2}(st|nd|rd|th)?)\b/.test(
          t,
        ) ||
          (/\b(instead|leave)\b/.test(t) && (DAY_WORDS.test(t) || hasDate(t))),
        "change_day",
      ],
      [/\b(allow|fine|ok|okay)\b.*\bovernight\b|\bovernight\b.*\b(fine|ok|okay|allowed)\b/.test(t), "relax_rule"],
      [
        /\b(first|second|third|1st|2nd|3rd|cheapest|fastest|balanced|best|that one|the (indigo|air india|nepal airlines) one)\b/.test(t),
        "pick_option",
      ],
    ],
    "other",
  );

  const optionPick = choose<OptionPick>(
    OPTION_PICKS,
    [
      [/\b(first|1st)\b/.test(t), "first"],
      [/\b(second|2nd)\b/.test(t), "second"],
      [/\b(third|3rd)\b/.test(t), "third"],
      [/\bcheap(est|er)?\b/.test(t), "cheapest"],
      [/\b(fast(est|er)?|quick(est)?)\b/.test(t), "fastest"],
      [/\b(best|recommended|balanced?)\b/.test(t), "balanced"],
    ],
    "none",
  );

  return {
    wantsFlight,
    party,
    assistanceFor,
    avoidsOvernight,
    priority,
    followUp,
    optionPick,
    latencyMs: 0,
    questionCount: OFFLINE_QUESTION_COUNT,
    model: OFFLINE_MODEL,
    source: "mock",
  };
}
