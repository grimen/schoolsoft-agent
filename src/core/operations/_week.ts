/**
 * The week model shared by the week-based operations and the connector's overview:
 * an ISO week named by its week-year, number and Monday–Sunday dates in
 * Europe/Stockholm. School portals are often asked for a week number alone, so the
 * year is the one in which that week starts nearest today (asked in December,
 * week 2 is next January's), and "today" is Stockholm's, never the server's zone.
 */
import { InputError } from "../errors/index.js";
import { isoWeekDate, isoWeekMonday, isoWeekYear, nearestWeekYear } from "../domain/time.js";
import { DAY, parseLocalDate, stockholmToday } from "./_calendar-range.js";

export interface WeekRange {
  /** ISO week-year. */
  year: number;
  /** ISO week number, 1–53. */
  week: number;
  /** Monday, YYYY-MM-DD. */
  startDate: string;
  /** Sunday, YYYY-MM-DD. */
  endDate: string;
}

/** The ISO week number of a `YYYY-MM-DD` date. */
export function isoWeekOfDate(date: string): number {
  const monday = isoWeekMonday(isoWeekYear(date), 1);
  return Math.floor((Date.parse(date + "T00:00:00Z") - monday) / (7 * DAY)) + 1;
}

function range(year: number, week: number): WeekRange {
  return {
    year,
    week,
    startDate: isoWeekDate(year, week, 1),
    endDate: isoWeekDate(year, week, 7),
  };
}

/** Week `week` (default: the current one) in the year where it starts nearest today. */
export function weekOf(week?: number, now = new Date()): WeekRange {
  const today = stockholmToday(now);
  const number = week ?? isoWeekOfDate(today);
  const year = nearestWeekYear(number, today);
  if (year === null) throw new InputError(`week ${number} does not exist in this or a nearby year`);
  return range(year, number);
}

/**
 * The ISO week containing `date`. Refused when its number alone would name the same
 * week of another year, so a portal asked for the number answers this very week.
 */
export function weekOfDate(date: string, now = new Date()): WeekRange {
  if (parseLocalDate(date) === null) throw new InputError("date must be a real YYYY-MM-DD date");
  const week = range(isoWeekYear(date), isoWeekOfDate(date));
  if (nearestWeekYear(week.week, stockholmToday(now)) !== week.year)
    throw new InputError(
      `the week of ${date} is too far from today; choose a date within about half a year`,
    );
  return week;
}
