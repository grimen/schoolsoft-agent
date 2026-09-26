import { z } from "zod";
import { defineOperation, READ_ONLY } from "./types.js";
import { ChildSchema, LimitSchema, withChild } from "./_shared.js";
import { MessageSchema } from "../domain/schemas.js";

export const getMessages = defineOperation({
  name: "get_messages",
  title: "Get message inbox",
  description: `List messages in the guardian's SchoolSoft inbox (newest first).

Args:
  - child_id (number, optional): selects the school whose inbox to read.
  - limit (number, optional): max items, default 20.
  - unread_only (boolean, optional): only unread messages.

Returns: { messages: [{ id, subject, preview, read, sender: { name } | null, sentAt, hasAttachments }] }.
For a full message body use get_message with the id.

Use when: "har jag fått något meddelande från skolan", "olästa meddelanden".`,
  input: {
    child_id: ChildSchema,
    limit: LimitSchema,
    unread_only: z.boolean().optional().describe("Only unread messages"),
  },
  output: z.object({ messages: z.array(MessageSchema) }),
  portal: ["getInbox"],
  annotations: READ_ONLY,
  async run(ctx, { child_id, limit, unread_only }) {
    const { guardian, orgId } = await withChild(ctx, child_id);
    let messages = await ctx.portal.getInbox(guardian.userId, orgId);
    if (unread_only) messages = messages.filter((m) => !m.read);
    return { messages: messages.slice(0, limit ?? 20) };
  },
});
