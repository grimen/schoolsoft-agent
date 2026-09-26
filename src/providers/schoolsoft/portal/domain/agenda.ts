/**
 * `GET /rest-api/parent/calendar/{lessons,event}/agenda` (app cookies): both
 * calendar sources as CalendarEvents. The field names come from the upstream
 * skolplattformen adapter and synthetic fixtures, not from a live response.
 */
import { z } from "zod";
import type { CalendarEvent } from "../../../../core/domain/schemas.js";
import { dateOrDateTime, optionalText, parseUpstream, upstreamId } from "./parse.js";

const rawAgenda = z.array(
  z.object({
    eventId: upstreamId,
    name: z.string(),
    startDate: dateOrDateTime,
    endDate: dateOrDateTime,
    allDay: z.boolean(),
    room: optionalText,
    teacher: optionalText,
    teachingGroup: optionalText,
    category: optionalText,
    description: optionalText,
  }),
);

export function toCalendarEvents(data: unknown, kind: "lesson" | "event"): CalendarEvent[] {
  return parseUpstream(rawAgenda, data, "getCalendar").map((e) => ({
    id: `${kind}:${e.eventId}@${e.startDate}`,
    kind,
    title: e.name,
    allDay: e.allDay,
    start: e.startDate,
    end: e.endDate,
    location: e.room,
    teacher: e.teacher,
    group: e.teachingGroup,
    category: e.category,
    note: e.description,
  }));
}

/** By start, then end, kind, id and title; equal entries from both sources are all kept. */
export function sortCalendar(events: CalendarEvent[]): CalendarEvent[] {
  return events.sort(
    (a, b) =>
      a.start.localeCompare(b.start) ||
      a.end.localeCompare(b.end) ||
      a.kind.localeCompare(b.kind) ||
      a.id.localeCompare(b.id) ||
      a.title.localeCompare(b.title),
  );
}
