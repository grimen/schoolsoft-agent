/**
 * The SchoolSoft web pages the browser provider reads, declared in one
 * place: path, whether the page sits behind the GDPR gate (web-login
 * cookies), and the anchors a healthy page must contain. Extractors key on
 * these anchors, `browser verify` and the live structure suite check them,
 * and `make fingerprints` records each page's structural fingerprint so an
 * upstream redesign shows up as named drift instead of empty data.
 */
import type { PortalPage } from "../browser/session.js";
import { extractSubjectLinks } from "./extractors.js";

export interface PageSpec {
  /** Path under the tenant, without query. */
  readonly path: string;
  /** Only reachable with the web-login cookies (SchoolSoft's "log in again" gate). */
  readonly web: boolean;
  /** Selectors that must match at least once on a healthy page. */
  readonly anchors: readonly string[];
  /**
   * Query string a verification visit needs (pages that render nothing
   * without a parameter), resolved on another page visited with that page's
   * own session (the subject menu only exists under the app session).
   */
  readonly exampleQuery?: {
    readonly from: PageKey;
    readonly resolve: (page: PortalPage) => Promise<string>;
  };
}

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
        if (!first) throw new Error("no subject with an id in the subject menu");
        return `?subject=${first.subjectId}&schooltype=7`;
      },
    },
  },
};

export const PAGE_KEYS = Object.keys(PAGES) as PageKey[];
