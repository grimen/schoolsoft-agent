/**
 * Which SchoolSoft backend serves each capability: its JSON APIs where
 * they exist, the headless browser over its legacy JSP pages otherwise.
 * Never add a browser path for something the API serves.
 */
import type { Capability, CapabilityRouting } from "../../core/portal/types.js";

export const ROUTING: Required<CapabilityRouting> = {
  getParent: ["api"],
  getLunchWeek: ["api"],
  getNews: ["api"],
  getInbox: ["api"],
  getMessage: ["api"],
  getNextCalendarEvent: ["api"],
  getSession: ["api"],
  getScheduleWeek: ["api"],
  getAssignmentsWeek: ["api"],
  getAssignmentDetail: ["api"],
  getActivityLog: ["api"],
  getContacts: ["browser"],
  getSubjectRooms: ["api"],
  getBookings: ["browser"],
  getFiles: ["browser"],
  getGrades: ["browser"],
  getStudentDocuments: ["browser"],
  getUnreportedAbsence: ["browser"],
  getAttendanceReport: ["browser"],
  getAssessmentCriteria: ["browser"],
  getGradePrognosis: ["api"],
};

/** Capabilities behind SchoolSoft's GDPR gate: need the web-login session, whichever backend serves them. */
export const WEB_SESSION_CAPABILITIES: readonly Capability[] = [
  "getGrades",
  "getStudentDocuments",
  "getUnreportedAbsence",
  "getAttendanceReport",
  "getAssessmentCriteria",
  "getGradePrognosis",
];

export const API_CAPABILITIES = (Object.keys(ROUTING) as Capability[]).filter((c) =>
  ROUTING[c].includes("api"),
);
export const BROWSER_CAPABILITIES = (Object.keys(ROUTING) as Capability[]).filter(
  (c) => !ROUTING[c].includes("api"),
);
