/**
 * The ordered list of every operation. Adding a capability = adding a file
 * and one entry here; MCP tools, CLI commands and reference docs follow.
 */
import type { Operation } from "./types.js";
import { findSchool } from "./find-school.js";
import { listChildren } from "./list-children.js";
import { getSchedule } from "./get-schedule.js";
import { getLunchMenu } from "./get-lunch-menu.js";
import { getAssignments } from "./get-assignments.js";
import { getAssignmentDetail } from "./get-assignment-detail.js";
import { getNews } from "./get-news.js";
import { getMessages } from "./get-messages.js";
import { getMessage } from "./get-message.js";
import { getContacts } from "./get-contacts.js";
import { getSubjectRooms } from "./get-subject-rooms.js";
import { getActivityLog } from "./get-activity-log.js";
import { getBookings } from "./get-bookings.js";
import { getFiles } from "./get-files.js";
import { getGrades } from "./get-grades.js";
import { getStudentDocuments } from "./get-student-documents.js";
import { getUnreportedAbsence } from "./get-unreported-absence.js";
import { getAttendanceReport } from "./get-attendance-report.js";
import { getAssessmentCriteria } from "./get-assessment-criteria.js";
import { getGradePrognosis } from "./get-grade-prognosis.js";
import { login } from "./login.js";
import { authStatus } from "./auth-status.js";
import { logout } from "./logout.js";

export const operations: readonly Operation[] = [
  findSchool,
  listChildren,
  getSchedule,
  getLunchMenu,
  getAssignments,
  getAssignmentDetail,
  getNews,
  getMessages,
  getMessage,
  getActivityLog,
  getContacts,
  getSubjectRooms,
  getBookings,
  getFiles,
  getGrades,
  getStudentDocuments,
  getUnreportedAbsence,
  getAttendanceReport,
  getAssessmentCriteria,
  getGradePrognosis,
  login,
  authStatus,
  logout,
] as unknown as readonly Operation[];

export function getOperation(name: string): Operation | undefined {
  return operations.find((o) => o.name === name);
}
