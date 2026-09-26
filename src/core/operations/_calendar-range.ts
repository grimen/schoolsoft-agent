import { AgentError } from "../errors/index.js";

export const DAY = 86_400_000;
export const CALENDAR_TIMEZONE = "Europe/Stockholm";

function invalidRange(): never {
  throw new AgentError({ kind: "input", key: "calendar_range", hint: "fix_input" });
}

/** A real YYYY-MM-DD calendar date as UTC-midnight milliseconds, or null. */
export function parseLocalDate(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(value + "T00:00:00Z");
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) return null;
  return time;
}

/** Today's date in Europe/Stockholm, whatever the server's timezone or the DST offset. */
export function stockholmToday(now = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: CALENDAR_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function dateValue(value: string): number {
  return parseLocalDate(value) ?? invalidRange();
}

/** Date-only arithmetic avoids server timezone and daylight-saving offsets. */
export function calendarRange(start?: string, end?: string, now = new Date()) {
  if (start === undefined && end === undefined) {
    const time = dateValue(stockholmToday(now));
    const monday = time - ((new Date(time).getUTCDay() + 6) % 7) * DAY;
    return {
      start_date: new Date(monday).toISOString().slice(0, 10),
      end_date: new Date(monday + 6 * DAY).toISOString().slice(0, 10),
    };
  }
  if (start === undefined || end === undefined) return invalidRange();
  const span = dateValue(end) - dateValue(start);
  if (span < 0 || span >= 366 * DAY) return invalidRange();
  return { start_date: start, end_date: end };
}
