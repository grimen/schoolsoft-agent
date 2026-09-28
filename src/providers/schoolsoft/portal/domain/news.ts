/**
 * `GET /eva/api/v2/parent/<userId>/schools/<orgId>/news?studentId=` (Bearer):
 * the school's news for one child. Field names recorded live 2026-09-06;
 * value types and date formats are assumed (see the E4.5 spec). `newsConfirm`
 * is recorded but its type is not, so it is not mapped.
 */
import { z } from "zod";
import type { NewsItem } from "../../../../core/domain/schemas.js";
import {
  dateOrDateTimeOrEpoch,
  dateTimeOrEpoch,
  label,
  optionalText,
  parseUpstream,
  upstreamId,
} from "./parse.js";

const rawNews = z.array(
  z.object({
    id: upstreamId,
    title: z.string(),
    description: optionalText,
    category: label,
    author: optionalText,
    read: z.boolean(),
    hasAttachment: z.boolean(),
    creDate: dateTimeOrEpoch,
    toDate: dateOrDateTimeOrEpoch.nullish().transform((v) => v ?? null),
  }),
);

export function toNews(data: unknown): NewsItem[] {
  return parseUpstream(rawNews, data, "getNews").map((n) => ({
    id: `news:${n.id}`,
    title: n.title,
    body: n.description,
    category: n.category,
    author: n.author,
    read: n.read,
    hasAttachments: n.hasAttachment,
    publishedAt: n.creDate,
    visibleUntil: n.toDate,
  }));
}
