/**
 * `get-lunch-menu --format text`: Monday to Friday, each with its dishes;
 * Saturday and Sunday only when the school lists them.
 */
import { isoWeekDate, type ChildRef, type Dish, type LunchDay } from "../../../core/index.js";
import { label } from "../labels.js";
import { cell, renderer, strong, type Line } from "../render.js";
import { dayTitle } from "../days.js";
import { clean, displayWidth, padEnd } from "../terminal.js";

interface LunchWeek {
  year: number;
  week: number;
  child: ChildRef;
  days: LunchDay[];
}

const WORKDAYS = [1, 2, 3, 4, 5];

function dish(d: Dish): string {
  const kind = d.kind === null ? "" : clean(d.kind);
  return kind ? `${kind}: ${cell(d.description)}` : cell(d.description);
}

export const lunchText = renderer<LunchWeek>((data, ctx) => {
  const { lang } = ctx;
  const heading = label(lang, "lunchHeading", {
    week: data.week,
    year: data.year,
    child: cell(data.child.firstName),
  });
  if (data.days.length === 0) return [heading, "", label(lang, "noLunchWeek")];
  const listed = new Map(data.days.map((d) => [d.weekday, d]));
  const weekdays = [...new Set([...WORKDAYS, ...listed.keys()])].sort((a, b) => a - b);
  const days = weekdays.map((weekday) => {
    const day = listed.get(weekday);
    const dishes = (day?.dishes ?? []).map(dish);
    const date = day?.date ?? isoWeekDate(data.year, data.week, weekday);
    const title = dayTitle(ctx, date);
    return {
      heading: title.text,
      today: title.today,
      dishes: dishes.length > 0 ? dishes : [label(lang, "noMenu")],
    };
  });
  const column = Math.max(...days.map((d) => displayWidth(d.heading))) + 2;
  const out: Line[] = [heading, ""];
  for (const day of days) {
    const first = padEnd(day.heading, column) + day.dishes[0];
    out.push(day.today ? strong(first) : first);
    out.push(...day.dishes.slice(1).map((d) => " ".repeat(column) + d));
  }
  return out;
});
