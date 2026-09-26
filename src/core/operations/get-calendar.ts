import { z } from "zod";
import { defineOperation, READ_ONLY } from "./types.js";
import { ChildSchema, withChild, FreshSchema } from "./_shared.js";
import { calendarRange, CALENDAR_TIMEZONE } from "./_calendar-range.js";
import { CalendarEventSchema, ChildRefSchema, LocalDateSchema } from "../domain/schemas.js";

export const getCalendar = defineOperation({
  name: "get_calendar",
  title: "Get full calendar",
  description: `Get lessons, lunch entries and school events published in one child's calendar.

Args:
  - start_date and end_date (optional): inclusive YYYY-MM-DD range, at most 366 days.
    Supply both or omit both for the current Monday–Sunday in Europe/Stockholm.
  - child_id (optional): from list_children; defaults to the child in focus.
  - fresh (boolean, optional): read from SchoolSoft now instead of a recent in-memory copy.

Returns: { startDate, endDate, timezone, child: { id, firstName }, events: [...] }.
Each event has id, kind ("lesson" or "event"), title, allDay, start, end,
location, teacher, group, category and note. start and end are dates for
date-only entries, otherwise ISO date-times with the Stockholm offset.
Both sources must succeed. School events depend on what the school publishes.
Lunch entries are timetable slots (category "lunch"); use get_lunch_menu for
dishes. Use get_schedule for the weekly timetable.

Use when: "What is happening at school next week?", "Show September's calendar",
"vad händer i skolan nästa vecka", "visa lektioner och skolhändelser".`,
  input: {
    start_date: z
      .string()
      .optional()
      .describe(
        "Inclusive start date, YYYY-MM-DD. Supply with end_date or omit both for this week.",
      ),
    end_date: z
      .string()
      .optional()
      .describe("Inclusive end date, YYYY-MM-DD. Maximum 366 days including start and end."),
    child_id: ChildSchema,
    fresh: FreshSchema,
  },
  output: z.object({
    startDate: LocalDateSchema,
    endDate: LocalDateSchema,
    timezone: z.literal(CALENDAR_TIMEZONE),
    child: ChildRefSchema,
    events: z.array(CalendarEventSchema),
  }),
  portal: ["getCalendar"],
  annotations: READ_ONLY,
  async run(ctx, { start_date, end_date, child_id }) {
    const range = calendarRange(start_date, end_date);
    const { childRef } = await withChild(ctx, child_id);
    const events = await ctx.portal.getCalendar(range.start_date, range.end_date);
    return {
      startDate: range.start_date,
      endDate: range.end_date,
      timezone: CALENDAR_TIMEZONE,
      child: childRef,
      events,
    };
  },
});
