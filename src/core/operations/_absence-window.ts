/**
 * When a child is reported absent: whole days or part of one day, validated
 * in Europe/Stockholm. Dates and times stay local wall-clock strings and are
 * never converted to instants, so a daylight-saving change cannot shift them.
 */
import { AgentError } from "../errors/index.js";
import { DAY, parseLocalDate, stockholmToday } from "./_calendar-range.js";

export const ABSENCE_MAX_DAYS = 14;

export interface AbsenceWindowInput {
  start_date?: string;
  end_date?: string;
  from_time?: string;
  to_time?: string;
}

export interface AbsenceWindow {
  start_date: string;
  end_date: string;
  /** Calendar days covered, inclusive. */
  days: number;
  full_day: boolean;
  from_time?: string;
  to_time?: string;
}

function invalid(): never {
  throw new AgentError({
    kind: "input",
    key: "absence_window",
    params: { max: ABSENCE_MAX_DAYS },
    hint: "fix_input",
  });
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function absenceWindow(input: AbsenceWindowInput, now = new Date()): AbsenceWindow {
  const today = stockholmToday(now);
  const start_date = input.start_date ?? today;
  const end_date = input.end_date ?? start_date;
  const start = parseLocalDate(start_date) ?? invalid();
  const end = parseLocalDate(end_date) ?? invalid();
  // `today` comes from Intl in a fixed locale, so it always parses.
  if (start < (parseLocalDate(today) as number) || end < start) return invalid();
  const days = (end - start) / DAY + 1;
  if (days > ABSENCE_MAX_DAYS) return invalid();

  const { from_time, to_time } = input;
  if (from_time === undefined && to_time === undefined)
    return { start_date, end_date, days, full_day: true };
  if (from_time === undefined || to_time === undefined) return invalid();
  if (!TIME.test(from_time) || !TIME.test(to_time) || to_time <= from_time || days !== 1)
    return invalid();
  return { start_date, end_date, days, full_day: false, from_time, to_time };
}
