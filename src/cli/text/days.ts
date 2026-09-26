/** Shared by the day-based views (schedule, calendar, lunch): day headings and grouping. */
import type { Lang } from "../../core/index.js";
import { label } from "./labels.js";
import { strong, type Line, type RenderContext } from "./render.js";
import { dayHeading } from "./time.js";

/** A day's heading text, marked when it is today. */
export function dayTitle(
  { lang, today }: RenderContext,
  date: string,
): { text: string; today: boolean } {
  const heading = dayHeading(lang, date);
  return date === today
    ? { text: `${heading} (${label(lang, "today")})`, today: true }
    : { text: heading, today: false };
}

/** A day's heading as a line, emphasised when it is today. */
export function dayLine(ctx: RenderContext, date: string): Line {
  const title = dayTitle(ctx, date);
  return title.today ? strong(title.text) : title.text;
}

/** Rows grouped under their dates (parallel arrays), days and rows in the order given. */
export function byDate(dates: string[], rows: string[]): Map<string, string[]> {
  const days = new Map<string, string[]>();
  dates.forEach((date, i) => days.set(date, [...(days.get(date) ?? []), rows[i]]));
  return days;
}

/** Blocks of rows under their day's heading, a blank line between days. */
export function dayBlocks(ctx: RenderContext, days: Map<string, string[]>): Line[] {
  const out: Line[] = [];
  for (const [date, rows] of days) {
    if (out.length > 0) out.push("");
    out.push(dayLine(ctx, date), ...rows);
  }
  return out;
}

/** " (until Wed 2026-09-02)" when an entry ends on a later day than it starts, else "". */
export function untilSuffix(lang: Lang, startDate: string, endDate: string): string {
  return endDate > startDate
    ? ` (${label(lang, "until", { date: dayHeading(lang, endDate) })})`
    : "";
}
