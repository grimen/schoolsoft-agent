import { defineOperation, READ_ONLY } from "./types.js";
import { ChildSchema, LimitSchema, withChild } from "./_shared.js";

export const getNews = defineOperation({
  name: "get_news",
  title: "Get news",
  description: `Get news/announcements from the child's school.

Args:
  - child_id (number, optional): from list_children.
  - limit (number, optional): max items, default 20.

Returns: { child, news: [{ id, title, description, category, creDate, toDate, read, hasAttachment, author }] }.

Use when: "något nytt från skolan", "senaste nyheterna".`,
  input: { child_id: ChildSchema, limit: LimitSchema },
  annotations: READ_ONLY,
  async run(ctx, { child_id, limit }) {
    const { guardian, orgId, child, childSummary } = await withChild(ctx, child_id);
    const news = await ctx.api.getNews(guardian.userId, orgId, child.studentId);
    return { child: childSummary, news: news.slice(0, limit ?? 20) };
  },
});
