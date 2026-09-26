/**
 * Dates and times of the domain model. School portals speak local wall-clock
 * time; the domain says which instant that is by attaching the offset
 * Europe/Stockholm had then (`2026-09-07T08:30:00+02:00`), so no consumer can
 * read it as UTC. Date-only values stay `YYYY-MM-DD`. No vendor knowledge here.
 */
export const DOMAIN_TIMEZONE = "Europe/Stockholm";

const MINUTE = 60_000;
const DAY = 86_400_000;

const WALL_CLOCK = new Intl.DateTimeFormat("en-US", {
  timeZone: DOMAIN_TIMEZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Stockholm's wall clock at an instant, expressed as if it were UTC milliseconds. */
function wallClock(instant: number): number {
  const p = Object.fromEntries(
    WALL_CLOCK.formatToParts(new Date(instant)).map((part) => [part.type, Number(part.value)]),
  );
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

/** Minutes east of UTC in Stockholm at an instant (60 or 120). */
export function stockholmOffsetMinutes(instant: number): number {
  const whole = Math.floor(instant / 1000) * 1000;
  return Math.round((wallClock(whole) - whole) / MINUTE);
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** Stockholm is always east of UTC (+01:00 or +02:00), so the sign is fixed. */
function format(wall: number, offset: number): string {
  const d = new Date(wall);
  return (
    `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}` +
    `+${pad(Math.floor(offset / 60))}:${pad(offset % 60)}`
  );
}

/** An instant (UTC milliseconds) as a Stockholm DateTime. */
export function instantToStockholm(instant: number): string {
  const offset = stockholmOffsetMinutes(instant);
  return format(Math.floor(instant / 1000) * 1000 + offset * MINUTE, offset);
}

/**
 * A Stockholm wall-clock time (given as UTC-style milliseconds) as a DateTime.
 * In the autumn fold the earlier (summer-time) instant wins; a time inside the
 * spring gap keeps the offset from before the change. Both are deterministic.
 */
export function wallClockToStockholm(wall: number): string {
  const before = stockholmOffsetMinutes(wall - 3 * 60 * MINUTE);
  const after = stockholmOffsetMinutes(wall + 3 * 60 * MINUTE);
  const offsets = [...new Set([before, after])].sort((a, b) => b - a);
  const offset = offsets.find((o) => wallClock(wall - o * MINUTE) === wall) ?? before;
  return format(wall, offset);
}

const TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?$/;

/** Date parts as UTC milliseconds, or null when they are not a real date and time. */
function realDate(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): number | null {
  const t = Date.UTC(y, mo - 1, d, h, mi, s);
  const back = new Date(t);
  return back.getUTCFullYear() === y &&
    back.getUTCMonth() === mo - 1 &&
    back.getUTCDate() === d &&
    back.getUTCHours() === h &&
    back.getUTCMinutes() === mi &&
    back.getUTCSeconds() === s
    ? t
    : null;
}

/**
 * Parse an ISO-8601-like timestamp (`T` or a space, optional seconds and
 * fraction). Without an offset it is Stockholm wall-clock time; with `Z` or an
 * offset it is converted to the Stockholm offset of the same instant. Null
 * when it is not a real date and time.
 */
export function toStockholmDateTime(value: string): string | null {
  const m = TIMESTAMP.exec(value.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1, 6).map(Number);
  const wall = realDate(y, mo, d, h, mi, m[6] === undefined ? 0 : Number(m[6]));
  if (wall === null) return null;
  const zone = m[7];
  if (zone === undefined) return wallClockToStockholm(wall);
  if (zone === "Z") return instantToStockholm(wall);
  const sign = zone.startsWith("-") ? -1 : 1;
  const digits = zone.slice(1).replace(":", "");
  const minutes = Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2));
  return instantToStockholm(wall - sign * minutes * MINUTE);
}

/** A real `YYYY-MM-DD` date, or null. */
export function toLocalDate(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  return realDate(Number(m[1]), Number(m[2]), Number(m[3])) === null ? null : m[0];
}

/** Monday of ISO week `week` in ISO week-year `year`, as UTC-midnight milliseconds. */
export function isoWeekMonday(year: number, week: number): number {
  const jan4 = Date.UTC(year, 0, 4);
  const mondayOfWeek1 = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY;
  return mondayOfWeek1 + (week - 1) * 7 * DAY;
}

/** 52 or 53. */
export function isoWeeksInYear(year: number): number {
  return isoWeekMonday(year + 1, 1) - isoWeekMonday(year, 1) === 53 * 7 * DAY ? 53 : 52;
}

/** The date of weekday `weekday` (1 = Monday … 7 = Sunday) in an ISO week. */
export function isoWeekDate(year: number, week: number, weekday: number): string {
  return new Date(isoWeekMonday(year, week) + (weekday - 1) * DAY).toISOString().slice(0, 10);
}

/** ISO week-year of a `YYYY-MM-DD` date. */
export function isoWeekYear(date: string): number {
  const t = Date.parse(date + "T00:00:00Z");
  const thursday = t + (3 - ((new Date(t).getUTCDay() + 6) % 7)) * DAY;
  return new Date(thursday).getUTCFullYear();
}

/**
 * The ISO week-year in which week `week` starts nearest `today`: asked in
 * December, week 2 is next January's. Null when no neighbouring year has
 * that week (week 53 in a run of 52-week years).
 */
export function nearestWeekYear(week: number, today: string): number | null {
  const now = Date.parse(today + "T00:00:00Z");
  const base = isoWeekYear(today);
  let best: number | null = null;
  for (const year of [base - 1, base, base + 1]) {
    if (week > isoWeeksInYear(year)) continue;
    const distance = Math.abs(isoWeekMonday(year, week) - now);
    if (best === null || distance < Math.abs(isoWeekMonday(best, week) - now)) best = year;
  }
  return best;
}
