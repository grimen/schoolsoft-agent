/**
 * UNVERIFIED. The request body of `POST /rest-api/parent/absence-notice`.
 *
 * Only the endpoint's existence is known (GET answers 405). Every field name
 * and format below is a guess made offline and MUST be corrected in the live
 * pass, from the request SchoolSoft's own absence form sends (names and free
 * text redacted). This function is the only place that knows the shape: fix
 * it here, update its test and the "Frånvaroanmälan" row in
 * docs/reference/schoolsoft-api.md, and nothing else has to change.
 */
import type { AbsenceNotice } from "../../../../core/portal/types.js";

export interface AbsenceNoticeBody {
  studentId: number;
  fromDate: string;
  toDate: string;
  fullDay: boolean;
  fromTime?: string;
  toTime?: string;
  comment?: string;
}

export function toAbsenceNoticeBody(notice: AbsenceNotice): AbsenceNoticeBody {
  return {
    studentId: notice.studentId,
    fromDate: notice.startDate,
    toDate: notice.endDate,
    fullDay: notice.fullDay,
    ...(notice.fullDay ? {} : { fromTime: notice.fromTime, toTime: notice.toTime }),
    ...(notice.reason ? { comment: notice.reason } : {}),
  };
}
