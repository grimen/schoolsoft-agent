import { z } from "zod";
import { defineOperation, READ_ONLY } from "./types.js";
import { ChildSchema, LimitSchema, withChild } from "./_shared.js";

export const getMessages = defineOperation({
  name: "get_messages",
  title: "Get message inbox",
  description: `List messages in the guardian's SchoolSoft inbox (newest first).

Args:
  - child_id (number, optional): selects the school whose inbox to read.
  - limit (number, optional): max items, default 20.
  - unread_only (boolean, optional): only unread messages.

Returns: { messages: [{ id, subject, message (preview), isRead, sender, date, hasFiles }] }.
For a full message body use get_message.

Use when: "har jag fått något meddelande från skolan", "olästa meddelanden".`,
  input: {
    child_id: ChildSchema,
    limit: LimitSchema,
    unread_only: z.boolean().optional().describe("Only unread messages"),
  },
  annotations: READ_ONLY,
  async run(ctx, { child_id, limit, unread_only }) {
    const { guardian, orgId } = await withChild(ctx, child_id);
    let messages = (await ctx.portal.getInbox(guardian.userId, orgId)) as { isRead?: boolean }[];
    if (unread_only) messages = messages.filter((m) => m.isRead === false);
    return { messages: messages.slice(0, limit ?? 20) };
  },
});
