/**
 * `GET /rest-api/parent/ps/assignments/start-page?week=&year=` (app cookies):
 * the assignments listed in one week. Field names recorded live 2026-09-06;
 * value types and the `sortDate` format are assumed (see the E4.5 spec).
 */
import { z } from "zod";
import type { Assignment } from "../../../../core/domain/schemas.js";
import { dateOrDateTimeOrEpoch, label, optionalText, parseUpstream } from "./parse.js";
import { subjectRoomId } from "./subject-rooms.js";

const rawAssignments = z.array(
  z.object({
    id: z.number().int(),
    activityId: z.number().int(),
    title: z.string(),
    subTitle: optionalText,
    read: z.boolean(),
    submissionStatus: label,
    resultReportStatus: label,
    sortDate: dateOrDateTimeOrEpoch,
  }),
);

export function toAssignments(data: unknown): Assignment[] {
  return parseUpstream(rawAssignments, data, "getAssignmentsWeek").map((a) => ({
    id: a.id,
    title: a.title,
    subtitle: a.subTitle,
    subjectRoomId: subjectRoomId(a.activityId),
    date: a.sortDate,
    read: a.read,
    submissionStatus: a.submissionStatus,
    resultStatus: a.resultReportStatus,
  }));
}
