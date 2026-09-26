import { AgentError } from "../errors/index.js";

const DAY = 86_400_000;
export const CALENDAR_TIMEZONE = "Europe/Stockholm";

function invalidRange(): never {
  throw new AgentError({ kind: "input", key: "calendar_range", hint: "fix_input" });
}

function dateValue(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return invalidRange();
  const time = Date.parse(value + "T00:00:00Z");
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value)
    return invalidRange();
  return time;
}

/** Date-only arithmetic avoids server timezone and daylight-saving offsets. */
export function calendarRange(start?: string, end?: string, now = new Date()) {
  if (start === undefined && end === undefined) {
    const today = new Intl.DateTimeFormat("sv-SE", {
      timeZone: CALENDAR_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    const time = dateValue(today);
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
