/**
 * Wall-clock time with explicit UTC offsets. Every timestamp in the flight job is an ISO string that
 * carries its airport's offset ("2026-10-10T06:40:00+05:30"), so math never depends on the machine's
 * time zone and clocks read exactly as they would on a ticket.
 */

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

const parts = (date: string) => date.split("-").map(Number) as [number, number, number];
const utcDate = (date: string) => {
  const [y, m, d] = parts(date);
  return new Date(Date.UTC(y, m - 1, d));
};

/** Calendar math on "YYYY-MM-DD" strings. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = parts(date);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday. */
export const weekdayOf = (date: string) => utcDate(date).getUTCDay();

/** "Sat, Oct 10" */
export const dayLabel = (date: string) =>
  utcDate(date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

/** "Sat" */
export const weekdayLabel = (date: string) => utcDate(date).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });

export const isoAt = (date: string, clock: string, offset: string) => `${date}T${clock}:00${offset}`;
export const toMs = (iso: string) => Date.parse(iso);
/** "06:40", as printed where it happens. */
export const clockOf = (iso: string) => iso.slice(11, 16);
/** "2026-10-10", the local date where it happens. */
export const dateOf = (iso: string) => iso.slice(0, 10);
export const minutesBetween = (from: string, to: string) => Math.round((toMs(to) - toMs(from)) / MINUTE);

/** "+05:45" → 345 */
export function offsetMinutes(offset: string): number {
  const m = offset.match(/^([+-])(\d{2}):(\d{2})$/);
  if (!m) return 0;
  const value = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === "-" ? -value : value;
}

/** The wall clock at a fixed offset for an instant. */
export function wallClock(ms: number, offset: string): { date: string; clock: string } {
  const iso = new Date(ms + offsetMinutes(offset) * MINUTE).toISOString();
  return { date: iso.slice(0, 10), clock: iso.slice(11, 16) };
}

/** "6h 40m", "45m", "2h" */
export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}
