import { completenessFor } from "@/lib/parse";
import { REFERENCE_RE } from "@/lib/parse/color";
import { CURRENCY_ALIASES } from "@/lib/parse/currency";
import { ZONES } from "@/lib/parse/timezone";
import {
  type Answer,
  type CardIntent,
  COLOR_MOODS,
  type ColorMood,
  EVENT_MODES,
  EXPENSE_CATEGORIES,
  INTENT_KEYS,
  type IntentKey,
  type IntentResult,
  noneResult,
  TIMER_KINDS,
  TONES,
  TRANSPORTS,
  TRIP_TYPES,
} from "./types";

/** Keep in sync with questions.ts (asserted in tests). */
export const MOCK_QUESTION_COUNT = 14;
export const MOCK_MODEL = "jev-offline";

const has = (re: RegExp, t: string) => re.test(t);

const DATE_WORDS = /\b(today|tonight|tomorrow|tmrw|mon(day)?|tue(s(day)?)?|wed(nesday)?|thu(rs(day)?)?|fri(day)?|sat(urday)?|sun(day)?|next week|this week|noon|midnight|morning|evening|\d{1,2}\s?(am|pm)|\d{1,2}:\d{2}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/;
const GATHER = /\b(dinner|lunch|breakfast|brunch|coffee|meeting|meet|call|sync|standup|party|drinks|date|catch ?up|interview|appointment|hangout|1:1|session with|with [a-z]+)\b/;
const UNIT = "(km|kms|kilomet(er|re)s?|mi|miles?|m|met(er|re)s?|cm|mm|ft|feet|foot|in|inch(es)?|yd|yards?|kg|kgs|kilos?|g|grams?|lbs?|pounds?|oz|ounces?|l|lit(er|re)s?|ml|gal(lons?)?|cups?|°?c|°?f|celsius|fahrenheit|kelvin|mph|kph|km/h)";
const CONVERT_FULL = new RegExp(`\\d\\s*${UNIT}\\s+(to|in|into|as)\\s+${UNIT}\\b`);
const CONVERT_PART = new RegExp(`\\d\\s*${UNIT}\\b`);
const CURRENCY_CODE = Object.keys(CURRENCY_ALIASES).sort((a, b) => b.length - a.length).join("|");
const CURRENCY_WORD_RE = new RegExp(`\\b(${CURRENCY_CODE})\\b`, "gi");
const CURRENCY_SYMBOL_RE = /[$€£₹¥₩]/;
const COLOR_WORDS = /\b(red|crimson|scarlet|maroon|burgundy|pink|rose|coral|salmon|peach|orange|tangerine|amber|gold|yellow|mustard|lemon|cream|beige|sand|tan|brown|chocolate|olive|lime|green|sage|mint|emerald|forest|teal|turquoise|cyan|sky|blue|navy|cobalt|indigo|violet|purple|lavender|lilac|magenta|plum|grey|gray|slate|charcoal|black|white|ivory)(ish)?\b/;

/** "minecraft diamond", "tiffany blue", "ruby": specific references that only mean a color. */
const COLOR_REFERENCE = new RegExp(REFERENCE_RE.source, "i");

const ZONE_WORD = new RegExp(`\\b(${Object.keys(ZONES).sort((a, b) => b.length - a.length).join("|")})\\b`, "g");
const CLOCK = /\b\d{1,2}(:\d{2})?\s*(am|pm)\b|\b\d{1,2}:\d{2}\b|\b(noon|midnight)\b/;

type Scores = Partial<Record<IntentKey, number>>;

function intentScores(raw: string): Scores {
  const t = raw.toLowerCase().trim();
  const words = t.split(/\s+/).filter(Boolean);
  const s: Scores = {};
  const add = (k: IntentKey, v: number) => (s[k] = (s[k] ?? 0) + v);
  const num = /\d/.test(t);

  if (has(/https?:\/\/|www\.|\b[a-z0-9-]+\.(com|dev|io|app|org|net|co|ai|in|so)\b/, t)) add("link", 6);
  if (has(/#[0-9a-f]{3}\b|#[0-9a-f]{6}\b|rgba?\(/, t)) add("color", 7);
  if (has(/#[0-9a-f]{1,5}$/, t)) add("color", 3);
  if (has(COLOR_WORDS, t)) add("color", 2.5);
  if (has(COLOR_REFERENCE, t)) add("color", 4.5);
  if (has(/\b(colou?r|shade|hue) (of|like)\b/, t)) add("color", 3);
  if (has(new RegExp(COLOR_WORDS.source + "\\s*$"), t)) add("color", 1.5);
  if (has(/\b(colou?r|shade|hue|palette|tone of)\b/, t)) add("color", 2);
  if (has(/[\w.+-]+@[\w-]+\.\w+/, t)) add("contact", 5);
  if (has(/(\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{3,5}/, t)) add("contact", 4);
  if (has(/\b(remind|reminder|don'?t forget|remember to)\b/, t)) add("reminder", 6);
  if (has(/\b(split|divide|share)\b/, t)) add("split", num ? 5 : 3);
  if (has(/\b(between|among)\s+(\d+|two|three|four|five|six)\b/, t) && num) add("split", 2);
  if (has(/\b(spent|paid|bought|cost|expense)\b/, t)) add("expense", num ? 5 : 3);
  if (has(/^(₹|rs\.?|\$)\s?\d/, t)) add("expense", 2);
  if (has(CONVERT_FULL, t)) add("convert", 7);
  else if (has(CONVERT_PART, t) && !has(/\b(min|mins|minutes?|hours?|hrs?|sec|secs?)\b/, t) && words.length <= 3) add("convert", 2);
  if (has(/\bconvert\b/, t)) add("convert", 3);
  const currencyHits = (t.match(CURRENCY_WORD_RE) ?? []).length + (has(CURRENCY_SYMBOL_RE, t) ? 1 : 0);
  if (num && currencyHits >= 2) add("currency", 7.5);
  else if (num && currencyHits === 1) add("currency", 2);
  if (has(/\b(exchange rate|currency)\b/, t) && currencyHits >= 1) add("currency", 3);
  if (has(/^[\d\s+\-*/x×÷^().,%]+$/, t) && has(/\d\s*[+\-*/x×÷^%]\s*[\d(]/, t)) add("calc", 7);
  if (has(/\d\s*%\s*(of|off)\b/, t)) add("calc", 6);
  if (has(/\b(what'?s|calculate|compute)\b.*\d/, t)) add("calc", 3);
  if (has(/\b(timer|countdown|stopwatch|pomodoro)\b/, t)) add("timer", 6);
  if (has(/\b\d+\s*(h|hr|hrs|hours?|m|min|mins|minutes?|s|sec|secs|seconds?)\b/, t)) add("timer", 3);
  if (has(/\b(focus|break|rest|nap|deep work)\b/, t) && has(/\d/, t)) add("timer", 2.5);
  if (has(/\b(every\s*day|daily|every (morning|night|evening)|each (day|morning)|\d\s*x\s*a\s*week|times a week|habit|weekly|every (mon|tue|wed|thu|fri|sat|sun))/, t)) add("habit", 5);
  if (has(/\b(flight|fly|flying|trip|travel|vacation|holiday|train to|bus to|road ?trip|visit|getaway)\b/, t)) add("travel", 5);
  if (has(/\bto [a-z]+/, t) && has(/\b(next weekend|this weekend|flight|trip)\b/, t)) add("travel", 1);
  if (has(/\b(or|vs)\b/, t) && t.endsWith("?")) add("poll", 5.5);
  else if (has(/\b\w+ or \w+/, t)) add("poll", 2);
  if (has(/\b(poll|vote)\b/, t)) add("poll", 3);
  // Countdown: "days until christmas", "how long till my birthday on dec 12"
  if (has(/\b(days?|weeks?|sleeps?)\s+(until|till|til|to go|left|before)\b|\bcount ?down\b|\bhow (many days|long) (until|till|til)\b/, t)) add("countdown", 6.5);
  // Time zones: two zones, a clock time plus a zone, or "time in tokyo"
  const zoneHits = t.match(ZONE_WORD)?.length ?? 0;
  if (zoneHits >= 2 && (has(CLOCK, t) || has(/\b(in|to)\b/, t))) add("timezone", 7);
  else if (zoneHits === 1 && (has(CLOCK, t) || has(/\btime\b/, t))) add("timezone", 5.5);
  // Random: dice, coins, "random number", "pick one"
  if (has(/\b(roll|flip|toss)\b|\b\d*d\d+\b|\bcoin\b|\bdice\b|\bdie\b|\brandom\b|\b(pick|choose) (one|a random|for me)\b/, t)) add("random", 6.5);
  // Goal: "4 of 12 books", "save 50000, saved 12000", "goal"
  if (has(/\b\d[\d,]*\s*(of|\/|out of)\s*\d[\d,]*\b/, t) && has(/[a-z]{3,}/, t)) add("goal", 4.5);
  if (has(/\b(goal|target)\b/, t)) add("goal", 3);
  if (has(/\b(done|so far|saved|completed|finished)\b/, t) && has(/\d/, t)) add("goal", (t.match(/\d+/g)?.length ?? 0) >= 2 ? 5 : 2.5);
  const listSeps = (t.match(/,|\band\b|&|\n/g) ?? []).length;
  if (listSeps >= 2) add("todo", 4);
  else if (listSeps === 1 && has(/^(buy|get|todo|to do|groceries)\b/, t)) add("todo", 3);
  if (has(/^(buy|get|pick up|grab)\b/, t)) add("todo", 2);
  const gather = has(GATHER, t);
  if (has(DATE_WORDS, t)) add("event", gather || words.length <= 6 ? 2.5 : 1);
  if (gather) add("event", 3);
  if (has(/\b(on|over|via) (zoom|meet|teams|facetime)\b/, t)) add("event", 2);
  if (has(/\b(i think|i feel|felt|feeling|thinking|wonder|realized|idea|thought|maybe we)\b/, t)) add("note", 2);
  if (words.length >= 8) add("note", 3);
  else if (words.length >= 5) add("note", 2.2);
  else if (words.length >= 3) add("note", 1);
  if (t.length < 3) add("none", 8);
  else if (words.length === 1 && !num) add("none", 3);
  else add("none", 0.5);

  // Mutual exclusions mirror the criteria wording.
  if ((s.split ?? 0) >= 5) s.calc = Math.min(s.calc ?? 0, 1);
  if ((s.convert ?? 0) >= 7) s.calc = Math.min(s.calc ?? 0, 1);
  if ((s.currency ?? 0) >= 7) {
    s.convert = Math.min(s.convert ?? 0, 1);
    s.expense = Math.min(s.expense ?? 0, 1);
    s.split = Math.min(s.split ?? 0, 1);
  }
  if ((s.expense ?? 0) >= 5 || (s.split ?? 0) >= 5) s.currency = Math.min(s.currency ?? 0, 1);
  if ((s.reminder ?? 0) >= 6) {
    s.event = Math.min(s.event ?? 0, 2.5);
    s.habit = Math.min(s.habit ?? 0, 2);
  }
  if ((s.habit ?? 0) >= 5) s.event = Math.min(s.event ?? 0, 2);
  if ((s.travel ?? 0) >= 5) s.event = Math.min(s.event ?? 0, 2);
  if ((s.poll ?? 0) >= 5) s.event = Math.min(s.event ?? 0, 2);
  if ((s.contact ?? 0) >= 4) s.timer = 0;
  if ((s.timer ?? 0) >= 3) s.convert = Math.min(s.convert ?? 0, 1);
  if ((s.link ?? 0) >= 6) s.note = 0;
  if ((s.countdown ?? 0) >= 6) s.event = Math.min(s.event ?? 0, 2);
  if ((s.timezone ?? 0) >= 5.5) {
    s.event = Math.min(s.event ?? 0, 2);
    s.convert = Math.min(s.convert ?? 0, 1);
    s.timer = Math.min(s.timer ?? 0, 1);
  }
  if ((s.random ?? 0) >= 6) {
    s.poll = Math.min(s.poll ?? 0, 2);
    s.calc = Math.min(s.calc ?? 0, 1);
    s.convert = Math.min(s.convert ?? 0, 1);
  }
  if ((s.goal ?? 0) >= 4.5) s.calc = Math.min(s.calc ?? 0, 1);
  return s;
}

function softmax(scores: Scores, temp = 1): Record<IntentKey, number> {
  const exps = INTENT_KEYS.map((k) => Math.exp((scores[k] ?? 0) / temp));
  const sum = exps.reduce((a, b) => a + b, 0);
  return Object.fromEntries(INTENT_KEYS.map((k, i) => [k, exps[i] / sum])) as Record<IntentKey, number>;
}

function pick<T extends string>(values: readonly T[], value: T, confidence: number): Answer<T> {
  const rest = (1 - confidence) / Math.max(1, values.length - 1);
  const probabilities = Object.fromEntries(values.map((v) => [v, v === value ? confidence : rest])) as Record<T, number>;
  return { value, confidence, probabilities };
}

function choose<T extends string>(values: readonly T[], t: string, rules: [RegExp, T][], fallback: T): Answer<T> {
  for (const [re, v] of rules) if (re.test(t)) return pick(values, v, 0.86);
  return pick(values, fallback, 0.74);
}

export function mockClassify(text: string): IntentResult {
  const t = text.toLowerCase().trim();
  if (t.length < 2) return noneResult({ model: MOCK_MODEL, questionCount: MOCK_QUESTION_COUNT, source: "mock" });

  const probs = softmax(intentScores(t), 0.8);
  const top = INTENT_KEYS.reduce((a, b) => (probs[b] > probs[a] ? b : a));
  const intent: Answer<IntentKey> = { value: top, confidence: probs[top], probabilities: probs };

  const colorMood: Answer<ColorMood> = choose(COLOR_MOODS, t, [
    [/\b(pastel|soft|pale|baby|light)\b/, "pastel"],
    [/\b(dark|deep|midnight|navy)\b/, "dark"],
    [/\b(neon|vivid|bright|electric|hot)\b/, "vivid"],
    [/\b(warm|sunset|fire|red|orange|yellow|amber|coral|peach|gold)\b/, "warm"],
    [/\b(cool|ocean|sea|sky|blue|green|teal|purple|mint|ice)\b/, "cool"],
    [/\b(grey|gray|beige|sand|stone|neutral|cream)\b/, "neutral"],
  ], "neutral");

  const readiness = top === "none" ? 0 : Math.min(2, completenessFor(top as CardIntent, text, { colorMood: colorMood.value }) * 2);

  const recurring = /\b(every|daily|weekly|monthly|each (day|week|morning)|\dx a week|times a week|repeat)/.test(t) ? 0.88 : 0.08;
  const urgentHit = /\b(urgent|asap|immediately|right now|important|critical|!!)/.test(t);
  const soonHit = /\b(today|tonight|soon|by \d|deadline|tomorrow)\b/.test(t);
  const urgencyScore = urgentHit ? 1.75 : soonHit ? 0.9 : 0.2;

  return {
    intent,
    readiness,
    signals: {
      isQuestion: /\?\s*$|^(what|why|how|when|where|who|should|could|would|is|are|do|does|can)\b/.test(t) ? 0.9 : 0.06,
      recurring,
      urgency: { score: urgencyScore, confidence: 0.8 },
      tone: choose(TONES, t, [
        [/\b(worried|stressed|anxious|ugh|deadline|panic|tired|frustrat)/, "stressed"],
        [/\b(can'?t wait|excited|yay|so pumped|!{1,}$)/, "excited"],
        [/\b(grateful|happy|love|thankful|glad|great)\b/, "positive"],
        [/\b(wonder|thinking about|realized|reflect|maybe|lately|i think)\b/, "reflective"],
      ], "neutral"),
      eventMode: choose(EVENT_MODES, t, [
        [/\b(zoom|meet|teams|facetime|video|skype|discord)\b/, "video_call"],
        [/\b(phone|call|ring)\b/, "phone_call"],
        [/\b(dinner|lunch|breakfast|coffee|drinks|party|at [a-z]+)\b/, "in_person"],
      ], "unspecified"),
      transport: choose(TRANSPORTS, t, [
        [/\b(flight|fly|flying|plane|airport)\b/, "flight"],
        [/\b(train|rail)\b/, "train"],
        [/\b(bus|coach)\b/, "bus"],
        [/\b(drive|car|road ?trip)\b/, "car"],
      ], "unspecified"),
      tripType: choose(TRIP_TYPES, t, [
        [/\b(work|business|conference|client|offsite|meeting)\b/, "work"],
        [/\b(vacation|holiday|beach|getaway|leisure|visit|weekend)\b/, "leisure"],
      ], "unspecified"),
      expenseCategory: choose(EXPENSE_CATEGORIES, t, [
        [/\b(uber|ola|cab|taxi|fuel|petrol|metro|bus|train|auto|parking)\b/, "transport"],
        [/\b(food|lunch|dinner|breakfast|coffee|groceries|swiggy|zomato|pizza|restaurant|drinks)\b/, "food"],
        [/\b(rent|electricity|wifi|internet|bill|recharge|netflix|spotify|subscription)\b/, "bills"],
        [/\b(movie|concert|game|tickets?|show)\b/, "entertainment"],
        [/\b(medicine|doctor|pharmacy|gym|hospital)\b/, "health"],
        [/\b(shoes|shirt|clothes|amazon|phone|laptop|headphones|gift)\b/, "shopping"],
      ], "other"),
      colorMood,
      timerKind: choose(TIMER_KINDS, t, [
        [/\b(focus|pomodoro|deep work|study|work)\b/, "focus"],
        [/\b(break|rest|nap|breather)\b/, "break"],
        [/\b(stopwatch|count up)\b/, "stopwatch"],
      ], "countdown"),
      hasExplicitOptions: /\b\w+\s+(or|vs)\s+\w+/.test(t) ? 0.9 : 0.05,
      isShoppingList: /\b(buy|get|groceries|shopping|milk|eggs|bread|coffee|pick up|order)\b/.test(t) ? 0.88 : 0.1,
    },
    latencyMs: Math.round(90 + Math.random() * 130),
    questionCount: MOCK_QUESTION_COUNT,
    model: MOCK_MODEL,
    source: "mock",
  };
}

export async function mockClassifyAsync(text: string, signal?: AbortSignal): Promise<IntentResult> {
  const result = mockClassify(text);
  await new Promise<void>((resolve, reject) => {
    const id = setTimeout(resolve, result.latencyMs);
    signal?.addEventListener("abort", () => {
      clearTimeout(id);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });
  return result;
}
