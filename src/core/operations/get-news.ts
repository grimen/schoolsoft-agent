import { z } from "zod";
import { defineOperation, READ_ONLY } from "./types.js";
import { ChildSchema, LimitSchema, withChild, FreshSchema } from "./_shared.js";
import { ChildRefSchema, NewsItemSchema } from "../domain/schemas.js";

export const getNews = defineOperation({
  name: "get_news",
  title: "Get news",
  description: `Get news/announcements from the child's school.

Args:
  - child_id (number, optional): from list_children.
  - limit (number, optional): max items, default 20.
  - fresh (boolean, optional): read from SchoolSoft now instead of a recent in-memory copy.

Returns: { child: { id, firstName }, news: [{ id, title, body, category, author, read, hasAttachments, publishedAt, visibleUntil }] }.

Use when: "något nytt från skolan", "senaste nyheterna".`,
  input: { child_id: ChildSchema, limit: LimitSchema, fresh: FreshSchema },
  output: z.object({ child: ChildRefSchema, news: z.array(NewsItemSchema) }),
  portal: ["getNews"],
  annotations: READ_ONLY,
  async run(ctx, { child_id, limit }) {
    const { guardian, orgId, child, childRef } = await withChild(ctx, child_id);
    const news = await ctx.portal.getNews(guardian.userId, orgId, child.studentId);
    return { child: childRef, news: news.slice(0, limit ?? 20) };
  },
});
