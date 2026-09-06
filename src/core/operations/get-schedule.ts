import { defineOperation, READ_ONLY } from "./types.js";
import { ChildSchema, WeekSchema, isoWeek, withChild } from "./_shared.js";

export const getSchedule = defineOperation({
  name: "get_schedule",
  title: "Get schedule",
  description: `Get the lesson schedule (timetable) for one child for a given ISO week.

Returns lessons with name, start/end (ISO datetime), room, teaching group
and teacher.

Args:
  - week (number, optional): ISO week 1–53. Defaults to current week.
  - child_id (number, optional): from list_children.

Returns: { week, child, lessons: [...] }

Use when: "vad har barnet på schemat", "när slutar skolan på fredag".`,
  input: { week: WeekSchema, child_id: ChildSchema },
  portal: ["getScheduleWeek"],
  annotations: READ_ONLY,
  async run(ctx, { week, child_id }) {
    const { childSummary } = await withChild(ctx, child_id);
    const w = week ?? isoWeek();
    const lessons = await ctx.portal.getScheduleWeek(w);
    return { week: w, child: childSummary, lessons };
  },
});
