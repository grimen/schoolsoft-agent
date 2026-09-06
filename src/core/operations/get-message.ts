import { z } from "zod";
import { defineOperation, READ_ONLY } from "./types.js";
import { ChildSchema, withChild } from "./_shared.js";

export const getMessage = defineOperation({
  name: "get_message",
  title: "Get one message",
  description: `Get the full body of one inbox message.

Args:
  - id (number): Message id from get_messages.
  - child_id (number, optional): selects the school.

Returns: { message: { id, subject, message, sender, date, recipients, attachments, ... } }.

Use when: the user wants to read a specific message listed by get_messages.`,
  input: { id: z.number().int().describe("Message id from get_messages"), child_id: ChildSchema },
  annotations: READ_ONLY,
  async run(ctx, { id, child_id }) {
    const { guardian, orgId } = await withChild(ctx, child_id);
    const message = await ctx.portal.getMessage(guardian.userId, orgId, id);
    return { message };
  },
});
