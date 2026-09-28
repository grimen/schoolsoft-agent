/**
 * Bokningar (`right_student_timebooking.jsp`, browser): the texts the page
 * extractor lifted, parsed into Bookings. The selectors were observed live
 * 2026-09-06; the time format and the status words are assumed from the
 * synthetic fixture (see the E4.5 spec). Text that does not parse is drift.
 */
import { z } from "zod";
import type { Booking } from "../../../../core/domain/schemas.js";
import { toLocalDate, toStockholmDateTime } from "../../../../core/domain/time.js";
import { optionalText, parseUpstream, textHash } from "./parse.js";

/** `2026-10-01 15:00`, optionally ` - 15:30` (same day), or a date alone. */
const WHEN = /^(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2})(?:\s*-\s*(\d{2}:\d{2}))?)?$/;

const when = z.string().transform((value, ctx) => {
  const m = WHEN.exec(value.trim());
  const start = m && (m[2] ? toStockholmDateTime(`${m[1]}T${m[2]}`) : toLocalDate(m[1]));
  const end = m?.[3] ? toStockholmDateTime(`${m[1]}T${m[3]}`) : null;
  if (!start || (m?.[3] && !end)) {
    ctx.addIssue({ code: "custom", message: "not a booking time" });
    return z.NEVER;
  }
  return { start, end };
});

const rawBookings = z.array(
  z.object({
    title: z.string().min(1),
    when,
    description: optionalText,
    details: z.array(z.object({ label: z.string(), value: z.string() })),
  }),
);

/** The page's wording → status; the first rule that matches wins. */
function statusOf(details: { value: string }[]): Booking["status"] {
  const words = details
    .map((d) => d.value)
    .join(" ")
    .toLowerCase();
  if (/bokad|booked/.test(words)) return "booked";
  if (/stängd|closed|passerad/.test(words)) return "closed";
  if (/ledig|open|tillgänglig/.test(words)) return "available";
  return "unknown";
}

export function toBookings(data: unknown): Booking[] {
  return parseUpstream(rawBookings, data, "getBookings").map((b) => ({
    id: `booking:${b.when.start}#${textHash(b.title)}`,
    title: b.title,
    description: b.description,
    start: b.when.start,
    end: b.when.end,
    status: statusOf(b.details),
    details: b.details,
  }));
}
