import { defineOperation, READ_ONLY } from "./types.js";
import { ChildSchema, LimitSchema, withChild, FreshSchema } from "./_shared.js";

export const getActivityLog = defineOperation({
  name: "get_activity_log",
  title: "Get activity log",
  description: `Get the school's activity log (Verksamhetslogg): posts from teachers about
what the class has been doing, newest first.

Args:
  - child_id (number, optional): from list_children.
  - limit (number, optional): max posts, default 20.
  - fresh (boolean, optional): read from SchoolSoft now instead of a recent in-memory copy.

Returns: { child, entries: [{ id, date, title, author, text, recipients, comments }] }.

Use when: "vad har de gjort i skolan den här veckan", "senaste inläggen från läraren".`,
  input: { child_id: ChildSchema, limit: LimitSchema, fresh: FreshSchema },
  portal: ["getActivityLog"],
  annotations: READ_ONLY,
  async run(ctx, { child_id, limit }) {
    const { childSummary } = await withChild(ctx, child_id);
    const entries = await ctx.portal.getActivityLog(limit ?? 20);
    return { child: childSummary, entries };
  },
});
