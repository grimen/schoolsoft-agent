import { defineOperation, READ_ONLY } from "./types.js";
import { ChildSchema, WeekSchema, YearSchema, isoWeek, withChild } from "./_shared.js";

export const getAssignments = defineOperation({
  name: "get_assignments",
  title: "Get assignments",
  description: `Get assignments (homework, tests, projects) for one child for a given ISO week.

Args:
  - week (number, optional): ISO week 1–53. Defaults to current week.
  - year (number, optional): Defaults to current year.
  - child_id (number, optional): from list_children.

Returns: { week, year, child, assignments: [{ id, title, subTitle, sortDate, submissionStatus, ... }] }.

Use when: "vilka läxor/prov finns den här veckan", "vad ska lämnas in".
For full details of one assignment, use get_assignment_detail.`,
  input: { week: WeekSchema, year: YearSchema, child_id: ChildSchema },
  annotations: READ_ONLY,
  async run(ctx, { week, year, child_id }) {
    const { childSummary } = await withChild(ctx, child_id);
    const w = week ?? isoWeek();
    const y = year ?? new Date().getFullYear();
    const assignments = await ctx.api.getAssignmentsWeek(w, y);
    return { week: w, year: y, child: childSummary, assignments };
  },
});
