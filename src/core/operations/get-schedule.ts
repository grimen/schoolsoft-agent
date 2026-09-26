import { z } from "zod";
import { defineOperation, READ_ONLY } from "./types.js";
import { ChildSchema, WeekSchema, withChild, FreshSchema } from "./_shared.js";
import { weekOf } from "./_week.js";
import { ChildRefSchema, LessonSchema, LocalDateSchema } from "../domain/schemas.js";

export const getSchedule = defineOperation({
  name: "get_schedule",
  title: "Get schedule",
  description: `Get the lesson schedule (timetable) for one child for a given ISO week.

Returns lessons with title, start/end (ISO date-time with the Stockholm offset),
room, teaching group, teacher and note, and the week's year, Monday and Sunday.

Args:
  - week (number, optional): ISO week 1–53. Defaults to current week; the week
    nearest today is meant (week 2 asked in December is next January's).
  - child_id (number, optional): from list_children.
  - fresh (boolean, optional): read from SchoolSoft now instead of a recent in-memory copy.

Returns: { year, week, startDate, endDate, child: { id, firstName }, lessons: [{ id, title, start, end, room, group, teacher, note }] }

Use when: "vad har barnet på schemat", "när slutar skolan på fredag".`,
  input: { week: WeekSchema, child_id: ChildSchema, fresh: FreshSchema },
  output: z.object({
    year: z
      .number()
      .int()
      .describe("ISO week-year: the year in which this week starts nearest today"),
    week: z.number().int().min(1).max(53),
    startDate: LocalDateSchema.describe("Monday of the week, YYYY-MM-DD in Europe/Stockholm"),
    endDate: LocalDateSchema.describe("Sunday of the week, YYYY-MM-DD in Europe/Stockholm"),
    child: ChildRefSchema,
    lessons: z.array(LessonSchema),
  }),
  portal: ["getScheduleWeek"],
  annotations: READ_ONLY,
  async run(ctx, { week, child_id }) {
    const range = weekOf(week);
    const { childRef } = await withChild(ctx, child_id);
    const lessons = await ctx.portal.getScheduleWeek(range.week);
    return { ...range, child: childRef, lessons };
  },
});
