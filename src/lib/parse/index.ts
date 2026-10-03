import type { CardIntent, ColorMood } from "@/lib/jev/types";
import { completeCalc, parseCalc, type CalcData } from "./calc";
import { completeColor, parseColor, type ColorData } from "./color";
import { completeContact, parseContact, type ContactData } from "./contact";
import { completeConvert, parseConvert, type ConvertData } from "./convert";
import { completeCurrency, parseCurrency, type CurrencyData } from "./currency";
import { completeEvent, parseEvent, type EventData } from "./event";
import { completeExpense, parseExpense, type ExpenseData } from "./expense";
import { completeHabit, parseHabit, type HabitData } from "./habit";
import { completeLink, parseLink, type LinkData } from "./link";
import { completeNote, parseNote, type NoteData } from "./note";
import { completePoll, parsePoll, type PollData } from "./poll";
import { completeReminder, parseReminder, type ReminderData } from "./reminder";
import { completeSplit, parseSplit, type SplitData } from "./split";
import { completeTimer, parseTimer, type TimerData } from "./timer";
import { completeTodo, parseTodo, type TodoData } from "./todo";
import { completeTravel, parseTravel, type TravelData } from "./travel";
import { completeCountdown, parseCountdown, type CountdownData } from "./countdown";
import { completeTimezone, parseTimezone, type TimezoneData } from "./timezone";
import { completeRandom, parseRandom, type RandomData } from "./random";
import { completeGoal, parseGoal, type GoalData } from "./goal";

export type ParsedMap = {
  event: EventData;
  reminder: ReminderData;
  todo: TodoData;
  timer: TimerData;
  habit: HabitData;
  color: ColorData;
  split: SplitData;
  expense: ExpenseData;
  convert: ConvertData;
  currency: CurrencyData;
  calc: CalcData;
  travel: TravelData;
  poll: PollData;
  contact: ContactData;
  link: LinkData;
  countdown: CountdownData;
  timezone: TimezoneData;
  random: RandomData;
  goal: GoalData;
  note: NoteData;
};

export type ParseContext = { ref?: Date; colorMood?: ColorMood | null };

type Parser<K extends CardIntent> = {
  parse: (text: string, ctx: ParseContext) => ParsedMap[K];
  complete: (data: ParsedMap[K]) => number;
};

export const parsers: { [K in CardIntent]: Parser<K> } = {
  event: { parse: (t, c) => parseEvent(t, c.ref), complete: completeEvent },
  reminder: { parse: (t, c) => parseReminder(t, c.ref), complete: completeReminder },
  todo: { parse: (t) => parseTodo(t), complete: completeTodo },
  timer: { parse: (t) => parseTimer(t), complete: completeTimer },
  habit: { parse: (t) => parseHabit(t), complete: completeHabit },
  color: { parse: (t, c) => parseColor(t, c.colorMood), complete: completeColor },
  split: { parse: (t) => parseSplit(t), complete: completeSplit },
  expense: { parse: (t) => parseExpense(t), complete: completeExpense },
  convert: { parse: (t) => parseConvert(t), complete: completeConvert },
  currency: { parse: (t) => parseCurrency(t), complete: completeCurrency },
  calc: { parse: (t) => parseCalc(t), complete: completeCalc },
  travel: { parse: (t, c) => parseTravel(t, c.ref), complete: completeTravel },
  poll: { parse: (t) => parsePoll(t), complete: completePoll },
  contact: { parse: (t) => parseContact(t), complete: completeContact },
  link: { parse: (t) => parseLink(t), complete: completeLink },
  countdown: { parse: (t, c) => parseCountdown(t, c.ref), complete: completeCountdown },
  timezone: { parse: (t, c) => parseTimezone(t, c.ref), complete: completeTimezone },
  random: { parse: (t) => parseRandom(t), complete: completeRandom },
  goal: { parse: (t) => parseGoal(t), complete: completeGoal },
  note: { parse: (t) => parseNote(t), complete: completeNote },
};

export function parseFor<K extends CardIntent>(intent: K, text: string, ctx: ParseContext = {}): ParsedMap[K] {
  return parsers[intent].parse(text, ctx);
}

/** 0..1, how filled-in the parsed card is. */
export function completenessFor<K extends CardIntent>(intent: K, text: string, ctx: ParseContext = {}): number {
  const p = parsers[intent];
  return p.complete(p.parse(text, ctx));
}
