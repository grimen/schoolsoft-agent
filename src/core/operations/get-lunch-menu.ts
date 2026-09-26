import { z } from "zod";
import { defineOperation, READ_ONLY } from "./types.js";
import { ChildSchema, WeekSchema, isoWeek, withChild, FreshSchema } from "./_shared.js";
import { stockholmToday } from "./_calendar-range.js";
import { ChildRefSchema, LunchDaySchema } from "../domain/schemas.js";
import { nearestWeekYear } from "../domain/time.js";
import { InputError } from "../errors/index.js";

/** The ISO week-year whose week `week` starts nearest today in Stockholm. */
export function lunchYear(week: number, now = new Date()): number {
  const year = nearestWeekYear(week, stockholmToday(now));
  if (year === null) throw new InputError(`week ${week} does not exist in this or a nearby year`);
  return year;
}

export const getLunchMenu = defineOperation({
  name: "get_lunch_menu",
  title: "Get lunch menu",
  description: `Get the school lunch menu for a given ISO week (the child's school).

Args:
  - week (number, optional): ISO week 1–53. Defaults to current week; the week
    nearest today is meant (week 2 asked in December is next January's).
  - child_id (number, optional): from list_children.
  - fresh (boolean, optional): read from SchoolSoft now instead of a recent in-memory copy.

Returns: { year, week, child: { id, firstName }, days: [{ date, weekday (1 = Monday), dishes: [{ kind, description }] }] }.

Use when: "vad är det till lunch", "vad serveras på onsdag".`,
  input: { week: WeekSchema, child_id: ChildSchema, fresh: FreshSchema },
  output: z.object({
    year: z.number().int().describe("ISO week-year"),
    week: z.number().int().min(1).max(53),
    child: ChildRefSchema,
    days: z.array(LunchDaySchema),
  }),
  portal: ["getLunchWeek"],
  annotations: READ_ONLY,
  async run(ctx, { week, child_id }) {
    const w = week ?? isoWeek();
    const year = lunchYear(w);
    const { orgId, childRef } = await withChild(ctx, child_id);
    const days = await ctx.portal.getLunchWeek(orgId, w, year);
    return { year, week: w, child: childRef, days };
  },
});
