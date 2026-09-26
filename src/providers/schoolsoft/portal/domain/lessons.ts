/**
 * `GET /rest-api/parent/calendar/lessons/week/<w>` (app cookies): the child in
 * focus's lessons for one week. Field names recorded live 2026-09-06; value
 * formats are assumed (see the typed-domain-model spec).
 */
import { z } from "zod";
import type { Lesson } from "../../../../core/domain/schemas.js";
import { dateTime, optionalText, parseUpstream, upstreamId } from "./parse.js";

const rawLessons = z.array(
  z.object({
    eventId: upstreamId,
    name: z.string(),
    startDate: dateTime,
    endDate: dateTime,
    room: optionalText,
    teachingGroup: optionalText,
    teacher: optionalText,
    description: optionalText,
  }),
);

export function toLessons(data: unknown): Lesson[] {
  return parseUpstream(rawLessons, data, "getScheduleWeek").map((l) => ({
    // A recurring event id is not known to be unique per occurrence; the start is.
    id: `lesson:${l.eventId}@${l.startDate}`,
    title: l.name,
    start: l.startDate,
    end: l.endDate,
    room: l.room,
    group: l.teachingGroup,
    teacher: l.teacher,
    note: l.description,
  }));
}
