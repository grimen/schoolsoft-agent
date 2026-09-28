/**
 * `GET /rest-api/parent/ps/subjectroom/all` and `/<activityId>/teachers` (app
 * cookies): the child in focus's subject rooms, then each room's teachers.
 * Field names recorded live 2026-09-06; value types are assumed.
 */
import { z } from "zod";
import type { SubjectRoom } from "../../../../core/domain/schemas.js";
import { label, parseUpstream } from "./parse.js";

const text = z
  .string()
  .nullish()
  .transform((v) => v?.trim() ?? "");

const rawRooms = z.array(
  z.object({
    activityId: z.number().int(),
    subject: z.string(),
    groupNames: z
      .array(z.string())
      .nullish()
      .transform((v) => v ?? []),
    isSubjectRoom: z.boolean().nullish(),
  }),
);

const rawTeachers = z.array(z.object({ firstName: z.string(), lastName: text, role: label }));

export type RawSubjectRoom = z.output<typeof rawRooms>[number];

/** The id a subject room has in the domain; assignments point at it. */
export const subjectRoomId = (activityId: number): string => `subject-room:${activityId}`;

/** The rooms to show: the portal marks some entries as not being subject rooms. */
export function toRoomList(data: unknown): RawSubjectRoom[] {
  return parseUpstream(rawRooms, data, "getSubjectRooms").filter((r) => r.isSubjectRoom !== false);
}

export function toSubjectRoom(room: RawSubjectRoom, teachers: unknown): SubjectRoom {
  return {
    id: subjectRoomId(room.activityId),
    name: room.subject,
    groups: room.groupNames,
    teachers: parseUpstream(rawTeachers, teachers, "getSubjectRooms")
      .map((t) => ({ name: `${t.firstName.trim()} ${t.lastName}`.trim(), role: t.role }))
      .filter((t) => t.name !== ""),
  };
}
