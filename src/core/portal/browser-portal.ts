/**
 * Browser provider of the Portal: the capabilities SchoolSoft only offers as
 * legacy web pages. Each method navigates (GET) to the page with the user's
 * cookies and runs a self-contained extractor inside it. Read-only by
 * construction: the session guard aborts every non-GET request.
 */
import type { BrowserSession } from "../browser/session.js";
import type { BrowserPortalPart } from "./composite.js";
import {
  WebLoginRequiredError,
  type Booking,
  type ContactGroup,
  type PortalFile,
  type SubjectRoom,
  type TablePage,
} from "./types.js";
import {
  extractBookings,
  extractContacts,
  extractFiles,
  extractSubjectLinks,
  extractSubjectTeachers,
  extractTablePage,
} from "./extractors.js";

export const PAGES = {
  contacts: "/jsp/student/right_student_class.jsp",
  subjects: "/jsp/student/right_student_subject.jsp",
  bookings: "/jsp/student/right_student_timebooking.jsp",
  files: "/jsp/student/right_student_library.jsp",
  // GDPR-gated (need the web session)
  grades: "/jsp/student/right_student_gradesubject.jsp",
  documents: "/jsp/student/right_student_review.jsp",
  unreportedAbsence: "/jsp/student/right_parent_absence_message.jsp",
  attendanceReport: "/jsp/student/right_student_absence_student.jsp",
  assessmentCriteria: "/jsp/student/right_student_ability.jsp",
} as const;

export interface BrowserPortalOptions {
  session: BrowserSession;
  /** Whether a web-login session is stored; gated pages refuse to try without one. */
  hasWebSession?: () => boolean;
  /** Align the web session's child in focus with the requested child before a gated page. */
  syncWebChild?: () => Promise<void>;
  /** Cap on per-subject page visits when listing subject rooms. */
  maxSubjectPages?: number;
}

export class BrowserPortal implements BrowserPortalPart {
  constructor(private readonly o: BrowserPortalOptions) {}

  getContacts(): Promise<ContactGroup[]> {
    return this.o.session.withPage(async (page) => {
      await page.goto(PAGES.contacts);
      return page.evaluate(extractContacts);
    });
  }

  getSubjectRooms(): Promise<SubjectRoom[]> {
    const max = this.o.maxSubjectPages ?? 25;
    return this.o.session.withPage(async (page) => {
      await page.goto(PAGES.subjects);
      const links = await page.evaluate(extractSubjectLinks);
      const rooms: SubjectRoom[] = [];
      for (const link of links.slice(0, max)) {
        await page.goto("/jsp/student/" + link.url.replace(/^\.?\/?/, ""));
        const teachers = await page.evaluate(extractSubjectTeachers);
        rooms.push({
          subject: link.subject,
          subjectId: link.subjectId,
          teachers,
          url: "/jsp/student/" + link.url,
        });
      }
      return rooms;
    });
  }

  getBookings(): Promise<Booking[]> {
    return this.o.session.withPage(async (page) => {
      await page.goto(PAGES.bookings);
      return page.evaluate(extractBookings);
    });
  }

  /**
   * GDPR-gated pages: carried by the web-login cookies (`web: true`), after
   * the web session's child in focus is aligned with the requested child.
   */
  private async gated(capability: string, path: string): Promise<TablePage> {
    if (this.o.hasWebSession && !this.o.hasWebSession())
      throw new WebLoginRequiredError(capability);
    await this.o.syncWebChild?.();
    return this.o.session.withPage(
      async (page) => {
        await page.goto(path);
        return page.evaluate(extractTablePage);
      },
      { web: true },
    );
  }

  getGrades(): Promise<TablePage> {
    return this.gated("getGrades", PAGES.grades);
  }
  getStudentDocuments(): Promise<TablePage> {
    return this.gated("getStudentDocuments", PAGES.documents);
  }
  getUnreportedAbsence(): Promise<TablePage> {
    return this.gated("getUnreportedAbsence", PAGES.unreportedAbsence);
  }
  getAttendanceReport(): Promise<TablePage> {
    return this.gated("getAttendanceReport", PAGES.attendanceReport);
  }
  getAssessmentCriteria(subjectId: number, schoolType = 7): Promise<TablePage> {
    return this.gated(
      "getAssessmentCriteria",
      `${PAGES.assessmentCriteria}?subject=${subjectId}&schooltype=${schoolType}`,
    );
  }

  getFiles(): Promise<PortalFile[]> {
    return this.o.session.withPage(async (page) => {
      await page.goto(PAGES.files);
      return page.evaluate(extractFiles);
    });
  }
}
