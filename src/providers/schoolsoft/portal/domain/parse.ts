/**
 * Shared pieces for mapping SchoolSoft's JSON to the domain model: parse a
 * raw answer against its schema (drift becomes ResponseDriftError naming the
 * capability), and the field parsers every shape uses. Raw schemas accept
 * what was recorded live plus what is plausibly the same thing (null or
 * absent optional text); anything else is drift, never a guess.
 */
import { z } from "zod";
import type { Capability } from "../../../../core/portal/types.js";
import { ResponseDriftError, describeIssues } from "../../../../core/errors/index.js";
import {
  instantToStockholm,
  toLocalDate,
  toStockholmDateTime,
} from "../../../../core/domain/time.js";

export function parseUpstream<S extends z.ZodType>(
  schema: S,
  data: unknown,
  capability: Capability,
): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success)
    throw new ResponseDriftError(capability, describeIssues(result.error.issues));
  return result.data;
}

/** Optional text: absent, null, empty or whitespace becomes null. */
export const optionalText = z
  .string()
  .nullish()
  .transform((v) => v?.trim() || null);

/** An upstream id: a non-empty string or an integer. */
export const upstreamId = z.union([z.string().min(1), z.number().int()]);

/** Local wall-clock timestamp (or one with an offset) → Stockholm DateTime. */
export const dateTime = z.string().transform((value, ctx) => {
  const parsed = toStockholmDateTime(value);
  if (parsed === null) {
    ctx.addIssue({ code: "custom", message: "not a date-time" });
    return z.NEVER;
  }
  return parsed;
});

/** A date-only value stays a date; anything else must be a date-time. */
export const dateOrDateTime = z.string().transform((value, ctx) => {
  const parsed = toLocalDate(value) ?? toStockholmDateTime(value);
  if (parsed === null) {
    ctx.addIssue({ code: "custom", message: "not a date or date-time" });
    return z.NEVER;
  }
  return parsed;
});

const epochMillis = z
  .number()
  .int()
  .positive()
  .transform((ms) => instantToStockholm(ms));

/** A timestamp as text, or as epoch milliseconds. */
export const dateTimeOrEpoch = z.union([dateTime, epochMillis]);

/** A label the portal words itself: text or a number, as trimmed text; empty or absent is null. */
export const label = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((v) => (v === null || v === undefined ? null : String(v).trim() || null));

/** A date stays a date; a timestamp (text or epoch milliseconds) becomes a DateTime. */
export const dateOrDateTimeOrEpoch = z.union([dateOrDateTime, epochMillis]);

/** Short, stable hash of a text for ids that must not repeat it: FNV-1a, 32 bits, hex. */
export function textHash(value: string): string {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
