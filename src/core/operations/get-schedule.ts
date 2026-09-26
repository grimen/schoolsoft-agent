import { z } from "zod";
import { defineOperation, READ_ONLY } from "./types.js";
import { ChildSchema, WeekSchema, isoWeek, withChild, FreshSchema } from "./_shared.js";
import { ChildRefSchema, LessonSchema } from "../domain/schemas.js";

export const getSchedule = defineOperation({
  name: "get_schedule",
  title: "Get schedule",
  description: `Get the lesson schedule (timetable) for one child for a given ISO week.

Returns lessons with title, start/end (ISO date-time with the Stockholm offset),
room, teaching group, teacher and note.

Args:
  - week (number, optional): ISO week 1–53. Defaults to current week.
  - child_id (number, optional): from list_children.
  - fresh (boolean, optional): read from SchoolSoft now instead of a recent in-memory copy.

Returns: { week, child: { id, firstName }, lessons: [{ id, title, start, end, room, group, teacher, note }] }

Use when: "vad har barnet på schemat", "när slutar skolan på fredag".`,
  input: { week: WeekSchema, child_id: ChildSchema, fresh: FreshSchema },
  output: z.object({
    week: z.number().int().min(1).max(53),
    child: ChildRefSchema,
    lessons: z.array(LessonSchema),
  }),
  portal: ["getScheduleWeek"],
  annotations: READ_ONLY,
  async run(ctx, { week, child_id }) {
    const { childRef } = await withChild(ctx, child_id);
    const w = week ?? isoWeek();
    const lessons = await ctx.portal.getScheduleWeek(w);
    return { week: w, child: childRef, lessons };
  },
});
