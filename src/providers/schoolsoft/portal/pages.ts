/**
 * The SchoolSoft web pages the browser provider reads, declared once (see
 * core/portal/page-spec.ts for what a declaration carries). Extractors key
 * on these anchors; `browser verify` and `make fingerprints` check them.
 */
import type { PageSpec } from "../../../core/portal/page-spec.js";
import { extractSubjectLinks } from "./extractors.js";
import { AgentError } from "../../../core/errors/index.js";

export type PageKey =
  | "contacts"
  | "subjects"
  | "bookings"
  | "files"
  | "grades"
  | "documents"
  | "unreportedAbsence"
  | "attendanceReport"
  | "assessmentCriteria";

export const PAGES: Record<PageKey, PageSpec> = {
  contacts: {
    path: "/jsp/student/right_student_class.jsp",
    web: false,
    anchors: ["#content .h1", "#contAll_content"],
  },
  /** Subject menu (JSP, app session only; the web session shows a React sidebar instead): the only source of the `requestid` the criteria page takes. */
  subjects: {
    path: "/jsp/student/right_student_subject.jsp",
    web: false,
    anchors: ["#content .h1", "#subject_menu a[href*='requestid=']"],
  },
  bookings: {
    path: "/jsp/student/right_student_timebooking.jsp",
    web: false,
    anchors: ["#content .h1", "#timebook_con_content"],
  },
  files: {
    path: "/jsp/student/right_student_library.jsp",
    web: false,
    anchors: ["#content .h1", "#library_con_content"],
  },
  grades: {
    path: "/jsp/student/right_student_gradesubject.jsp",
    web: true,
    anchors: ["#content .h1"],
  },
  documents: {
    path: "/jsp/student/right_student_review.jsp",
    web: true,
    anchors: ["#content .h1", "#review_cont"],
  },
  unreportedAbsence: {
    path: "/jsp/student/right_parent_absence_message.jsp",
    web: true,
    anchors: ["#content .h1", "#content .alert .message-text, #content table"],
  },
  attendanceReport: {
    path: "/jsp/student/right_student_absence_student.jsp",
    web: true,
    anchors: ["#content .h1", "#content form[name='select']", "#content table.table"],
  },
  assessmentCriteria: {
    path: "/jsp/student/right_student_ability.jsp",
    web: true,
    anchors: ["#content .h1", "#content tr.longlistheader"],
    exampleQuery: {
      from: "subjects",
      resolve: async (page) => {
        const first = (await page.evaluate(extractSubjectLinks)).find((l) => l.subjectId !== null);
        if (!first) throw new AgentError({ kind: "upstream", key: "subject_menu_empty" });
        return `?subject=${first.subjectId}&schooltype=7`;
      },
    },
  },
};

export const PAGE_KEYS = Object.keys(PAGES) as PageKey[];
