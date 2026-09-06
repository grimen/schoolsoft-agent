import { defineOperation, READ_ONLY } from "./types.js";
import { ChildSchema, withChild } from "./_shared.js";

export const getGradePrognosis = defineOperation({
  name: "get_grade_prognosis",
  title: "Get grade prognosis dates",
  description: `Avstämning: the reconciliation dates SchoolSoft has for the child's grade
prognosis. Empty until the school runs one.

GDPR-gated at SchoolSoft: needs a WEB login session (run "schoolsoft-agent login --web",
or the login tool with web: true, once). No browser needed. Read only.

Args:
  - child_id (number, optional): from list_children.

Returns: { child, reconciliationDates }.

Use when: "har skolan gjort någon avstämning", "när är nästa avstämning".`,
  input: { child_id: ChildSchema },
  annotations: READ_ONLY,
  async run(ctx, { child_id }) {
    const { childSummary } = await withChild(ctx, child_id);
    const { reconciliationDates } = await ctx.portal.getGradePrognosis();
    return { child: childSummary, reconciliationDates };
  },
});
