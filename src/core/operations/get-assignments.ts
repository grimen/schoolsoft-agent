import { defineOperation, READ_ONLY } from "./types.js";
import { ChildSchema, WeekSchema, YearSchema, isoWeek, withChild, FreshSchema } from "./_shared.js";
import { weekOf } from "./_week.js";

export const getAssignments = defineOperation({
  name: "get_assignments",
  title: "Get assignments",
  description: `Get assignments (homework, tests, projects) for one child for a given ISO week.

Args:
  - week (number, optional): ISO week 1–53. Defaults to current week.
  - year (number, optional): Defaults to the year that week belongs to, nearest today
    (week 1 asked in late December is next January's, as for get_schedule).
  - child_id (number, optional): from list_children.
  - fresh (boolean, optional): read from SchoolSoft now instead of a recent in-memory copy.

Returns: { week, year, child, assignments: [{ id, title, subTitle, sortDate, submissionStatus, ... }] }.

Use when: "vilka läxor/prov finns den här veckan", "vad ska lämnas in".
For full details of one assignment, use get_assignment_detail.`,
  input: { week: WeekSchema, year: YearSchema, child_id: ChildSchema, fresh: FreshSchema },
  portal: ["getAssignmentsWeek"],
  annotations: READ_ONLY,
  async run(ctx, { week, year, child_id }) {
    const { childSummary } = await withChild(ctx, child_id);
    const w = week ?? isoWeek();
    // The week's own year, not the calendar year: around New Year they differ (1 January
    // can lie in week 53 of the year before, 30 December in week 1 of the year after).
    const y = year ?? weekOf(w).year;
    const assignments = await ctx.portal.getAssignmentsWeek(w, y);
    return { week: w, year: y, child: childSummary, assignments };
  },
});
