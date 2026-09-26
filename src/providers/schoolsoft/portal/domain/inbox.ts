/**
 * `GET /eva/api/v1/parent/<userId>/schools/<orgId>/messages/inbox` (Bearer):
 * message summaries. Field names recorded live 2026-09-06; the `date` format
 * was not, so text timestamps and epoch milliseconds are both accepted.
 */
import { z } from "zod";
import type { Message } from "../../../../core/domain/schemas.js";
import { dateTimeOrEpoch, parseUpstream } from "./parse.js";

const rawInbox = z.array(
  z.object({
    id: z.number().int(),
    subject: z.string(),
    message: z
      .string()
      .nullish()
      .transform((v) => v ?? ""),
    isRead: z.boolean(),
    sender: z
      .object({
        firstName: z
          .string()
          .nullish()
          .transform((v) => v ?? ""),
        lastName: z
          .string()
          .nullish()
          .transform((v) => v ?? ""),
      })
      .nullish(),
    date: dateTimeOrEpoch,
    hasFiles: z.boolean(),
  }),
);

export function toMessages(data: unknown): Message[] {
  return parseUpstream(rawInbox, data, "getInbox").map((m) => {
    const name = m.sender ? `${m.sender.firstName} ${m.sender.lastName}`.trim() : "";
    return {
      id: m.id,
      subject: m.subject,
      preview: m.message,
      read: m.isRead,
      sender: name ? { name } : null,
      sentAt: m.date,
      hasAttachments: m.hasFiles,
    };
  });
}
