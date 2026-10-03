import {
  AlarmClock,
  Banknote,
  CalendarClock,
  Dices,
  Globe,
  Target,
  Bell,
  Briefcase,
  CalendarDays,
  Calculator,
  CircleAlert,
  Coffee,
  Contact,
  Focus,
  Link2,
  ListChecks,
  Palette,
  Repeat,
  Ruler,
  ShoppingCart,
  StickyNote,
  Sun,
  Timer,
  Users,
  Vote,
  Wallet,
} from "lucide-react";
import type { CardIntent } from "@/lib/jev/types";
import { formatAmount } from "@/lib/parse/common";
import { UNIT_LABELS } from "@/lib/parse/convert";
import { formatClock } from "@/lib/parse/timer";
import { describeRandom } from "@/lib/parse/random";
import { formatIn } from "@/lib/parse/timezone";
import type { GatedSignals } from "@/lib/signals";
import { CalcCard } from "./CalcCard";
import { CountdownCard } from "./CountdownCard";
import { GoalCard } from "./GoalCard";
import { RandomCard } from "./RandomCard";
import { TimezoneCard } from "./TimezoneCard";
import { ColorPicker } from "./ColorPicker";
import { ContactCard } from "./ContactCard";
import { ConvertCard } from "./ConvertCard";
import { CurrencyCard } from "./CurrencyCard";
import { EventCard } from "./EventCard";
import { ExpenseRow } from "./ExpenseRow";
import { HabitCard } from "./HabitCard";
import { CATEGORY_ICON, TRANSPORT_ICON } from "./icons";
import { LinkCard } from "./LinkCard";
import { NoteCard } from "./NoteCard";
import { PollCard } from "./PollCard";
import { ReminderPill } from "./ReminderPill";
import { formatWhen } from "./shared";
import { SplitCard } from "./SplitCard";
import { TimerRing } from "./TimerRing";
import { TodoList } from "./TodoList";
import { TravelCard } from "./TravelCard";
import type { BadgeSpec, Registry } from "./types";

const repeats = (s: GatedSignals): BadgeSpec[] => (s.recurring ? [{ id: "repeat", label: "Repeats", icon: Repeat }] : []);
const urgent = (s: GatedSignals): BadgeSpec[] => (s.urgent ? [{ id: "urgent", label: "Urgent", icon: CircleAlert, tone: "caution" }] : []);

const TONE_LABEL = {
  neutral: "Note",
  positive: "Upbeat note",
  excited: "Excited note",
  stressed: "Stressed note",
  reflective: "Reflective note",
} as const;

const TONE_EDGE = {
  neutral: null,
  positive: "var(--positive)",
  excited: "var(--brand)",
  stressed: "var(--caution)",
  reflective: "var(--line-strong)",
} as const;

/**
 * intent → everything needed to render it. Adding a UI type means one entry here,
 * one criterion in questions.ts, one parser and one component.
 */
export const registry: Registry = {
  event: {
    label: "Event",
    example: "dinner with priya friday 8pm",
    icon: CalendarDays,
    signals: ["eventMode", "recurring"],
    badges: repeats,
    summary: (d) => [d.title || "Event", d.date && Object.values(formatWhen(d.date, d.hasTime)).filter(Boolean).join(", ")].filter(Boolean).join(" · "),
    Component: EventCard,
  },
  reminder: {
    label: "Reminder",
    example: "remind me to call mom tomorrow",
    icon: Bell,
    signals: ["urgency", "recurring"],
    badges: (s) => [...urgent(s), ...repeats(s)],
    edge: (s) => (s.urgent ? "var(--caution)" : null),
    summary: (d) => [d.task || "Reminder", d.when && formatWhen(d.when, d.hasTime).day].filter(Boolean).join(" · "),
    Component: ReminderPill,
  },
  todo: {
    label: "Checklist",
    example: "buy milk, eggs, bread and coffee",
    icon: ListChecks,
    signals: ["isShoppingList", "urgency"],
    headerIcon: (s) => (s.isShoppingList ? ShoppingCart : ListChecks),
    headerLabel: (s) => (s.isShoppingList ? "Shopping" : "Checklist"),
    badges: urgent,
    summary: (d) => `${d.items.length} item${d.items.length === 1 ? "" : "s"} · ${d.items.slice(0, 3).join(", ")}`,
    Component: TodoList,
  },
  timer: {
    label: "Timer",
    example: "25 min focus",
    icon: Timer,
    signals: ["timerKind"],
    headerIcon: (s) => (s.timerKind === "focus" ? Focus : s.timerKind === "break" ? Coffee : s.timerKind === "stopwatch" ? AlarmClock : Timer),
    headerLabel: (s) => (s.timerKind === "focus" ? "Focus" : s.timerKind === "break" ? "Break" : s.timerKind === "stopwatch" ? "Stopwatch" : "Timer"),
    summary: (d) => [d.label || "Timer", d.seconds && formatClock(d.seconds)].filter(Boolean).join(" · "),
    Component: TimerRing,
  },
  habit: {
    label: "Habit",
    example: "meditate every morning",
    icon: Sun,
    signals: [],
    summary: (d) => [d.title || "Habit", d.label].filter(Boolean).join(" · "),
    Component: HabitCard,
  },
  color: {
    label: "Color",
    example: "#ff6b35",
    icon: Palette,
    signals: ["colorMood"],
    summary: (d) => [d.name ? d.name[0].toUpperCase() + d.name.slice(1) : "Color", d.hex?.toUpperCase()].filter(Boolean).join(" · "),
    Component: ColorPicker,
  },
  split: {
    label: "Split",
    example: "split 2400 between 3",
    icon: Users,
    signals: [],
    summary: (d) =>
      d.total && d.people ? `${formatAmount(d.total, d.currency)} ÷ ${d.people} = ${formatAmount(d.total / d.people, d.currency)} each` : "Split",
    Component: SplitCard,
  },
  expense: {
    label: "Expense",
    example: "spent 450 on uber",
    icon: Wallet,
    signals: ["expenseCategory"],
    headerIcon: (s) => (s.expenseCategory ? CATEGORY_ICON[s.expenseCategory] : Wallet),
    summary: (d) => [d.amount !== null && formatAmount(d.amount, d.currency), d.item].filter(Boolean).join(" · ") || "Expense",
    Component: ExpenseRow,
  },
  convert: {
    label: "Convert",
    example: "5 miles in km",
    icon: Ruler,
    signals: [],
    summary: (d) =>
      d.value !== null && d.from && d.to && d.result !== null
        ? `${d.value} ${UNIT_LABELS[d.from] ?? d.from} = ${Number(d.result.toFixed(2))} ${UNIT_LABELS[d.to] ?? d.to}`
        : "Conversion",
    Component: ConvertCard,
  },
  currency: {
    label: "Currency",
    example: "100 usd to inr",
    icon: Banknote,
    signals: [],
    summary: (d) => (d.value !== null && d.from && d.to ? `${d.value} ${d.from} → ${d.to}` : "Currency exchange"),
    Component: CurrencyCard,
  },
  calc: {
    label: "Calculate",
    example: "18% of 3450",
    icon: Calculator,
    signals: [],
    summary: (d) => (d.result !== null ? `${d.expression} = ${d.result.toLocaleString("en-US")}` : d.expression),
    Component: CalcCard,
  },
  travel: {
    label: "Trip",
    example: "flight to goa next weekend",
    icon: TRANSPORT_ICON.flight,
    signals: ["transport", "tripType"],
    headerIcon: (s) => TRANSPORT_ICON[s.transport ?? "unspecified"],
    badges: (s) =>
      s.tripType === "work"
        ? [{ id: "work", label: "Work", icon: Briefcase }]
        : s.tripType === "leisure"
          ? [{ id: "leisure", label: "Leisure", icon: Sun }]
          : [],
    summary: (d) => (d.destination ? `Trip to ${d.destination}` : "Trip"),
    Component: TravelCard,
  },
  poll: {
    label: "Poll",
    example: "pizza or burgers for friday?",
    icon: Vote,
    signals: ["hasExplicitOptions"],
    summary: (d) => d.title || d.options.join(" / ") || "Poll",
    Component: PollCard,
  },
  contact: {
    label: "Contact",
    example: "rahul 98200 12345 rahul@mail.com",
    icon: Contact,
    signals: [],
    summary: (d) => [d.name || "Contact", d.phone ?? d.email].filter(Boolean).join(" · "),
    Component: ContactCard,
  },
  link: {
    label: "Bookmark",
    example: "https://vercel.com/blog check later",
    icon: Link2,
    signals: [],
    summary: (d) => [d.domain ?? "Link", d.note].filter(Boolean).join(" · "),
    Component: LinkCard,
  },
  countdown: {
    label: "Countdown",
    example: "days until christmas",
    icon: CalendarClock,
    signals: [],
    summary: (d) =>
      d.days === null ? d.title || "Countdown" : d.days === 0 ? `${d.title || "It"} is today` : `${Math.abs(d.days)} days ${d.days < 0 ? "since" : "until"} ${d.title || "then"}`,
    Component: CountdownCard,
  },
  timezone: {
    label: "Time zone",
    example: "3pm pst in ist",
    icon: Globe,
    signals: [],
    summary: (d) =>
      d.to && d.instant ? `${formatIn(d.from.tz, d.instant)} ${d.from.label} → ${formatIn(d.to.tz, d.instant)} ${d.to.label}` : "Time zones",
    Component: TimezoneCard,
  },
  random: {
    label: "Random",
    example: "roll 2d6",
    icon: Dices,
    signals: [],
    summary: (d) => describeRandom(d),
    Component: RandomCard,
  },
  goal: {
    label: "Goal",
    example: "read 12 books this year, 4 done",
    icon: Target,
    signals: [],
    summary: (d) => (d.target ? `${d.title || "Goal"} · ${d.current}/${d.target}${d.unit ? ` ${d.unit}` : ""}` : d.title || "Goal"),
    Component: GoalCard,
  },
  note: {
    label: "Note",
    example: "the city felt so quiet this morning",
    icon: StickyNote,
    signals: ["tone", "isQuestion"],
    // The edge color is always paired with a tone word in the header, never color alone.
    headerLabel: (s) => (s.tone ? TONE_LABEL[s.tone] : "Note"),
    edge: (s) => (s.tone ? TONE_EDGE[s.tone] : null),
    summary: (d) => d.title,
    Component: NoteCard,
  },
};

export const CARD_INTENTS = Object.keys(registry) as CardIntent[];
