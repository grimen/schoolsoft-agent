/**
 * Dates and times as a person in Sweden reads them, from the domain's ISO
 * values. A DateTime is an instant and is shown on Stockholm's wall clock
 * through Intl with an explicit time zone, so the machine's own zone never
 * matters; a LocalDate is already a Stockholm date and is shown as it is.
 */
import { DOMAIN_TIMEZONE, type Lang } from "../../core/index.js";
import { label, type LabelKey } from "./labels.js";

const STOCKHOLM = new Intl.DateTimeFormat("en-US", {
  timeZone: DOMAIN_TIMEZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export interface LocalMoment {
  /** YYYY-MM-DD in Stockholm. */
  date: string;
  /** HH:MM in Stockholm, or null for a date-only value. */
  time: string | null;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** A domain LocalDate or DateTime on Stockholm's calendar and clock. */
export function stockholm(value: string): LocalMoment {
  if (DATE_ONLY.test(value)) return { date: value, time: null };
  return instant(Date.parse(value));
}

function instant(ms: number): LocalMoment {
  const p = Object.fromEntries(
    STOCKHOLM.formatToParts(new Date(ms)).map((part) => [part.type, part.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/** Stockholm's date at an instant (the injected clock). */
export function stockholmDate(nowMs: number): string {
  return instant(nowMs).date;
}

/** ISO weekday of a YYYY-MM-DD date: 1 = Monday … 7 = Sunday. */
export function weekdayOf(date: string): number {
  return ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
}

/** Short weekday name, 1 = Monday. */
export function weekdayName(lang: Lang, weekday: number): string {
  return label(lang, `weekday${weekday}` as LabelKey);
}

/** "Mon 2026-08-31" / "mån 2026-08-31". */
export function dayHeading(lang: Lang, date: string): string {
  return `${weekdayName(lang, weekdayOf(date))} ${date}`;
}
