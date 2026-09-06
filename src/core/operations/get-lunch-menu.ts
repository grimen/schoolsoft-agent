import { defineOperation, READ_ONLY } from "./types.js";
import { ChildSchema, WeekSchema, isoWeek, withChild } from "./_shared.js";

export const getLunchMenu = defineOperation({
  name: "get_lunch_menu",
  title: "Get lunch menu",
  description: `Get the school lunch menu for a given ISO week (the child's school).

Args:
  - week (number, optional): ISO week 1–53. Defaults to current week.
  - child_id (number, optional): from list_children.

Returns: { week, child, menu: [{ week, dayId (Mon=1…Fri=5), dishes: [{ mealType, description }] }] }.

Use when: "vad är det till lunch", "vad serveras på onsdag".`,
  input: { week: WeekSchema, child_id: ChildSchema },
  annotations: READ_ONLY,
  async run(ctx, { week, child_id }) {
    const { orgId, childSummary } = await withChild(ctx, child_id);
    const w = week ?? isoWeek();
    const menu = await ctx.portal.getLunchWeek(orgId, w);
    return { week: w, child: childSummary, menu };
  },
});
