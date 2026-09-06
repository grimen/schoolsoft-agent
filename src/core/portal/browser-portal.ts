/**
 * Browser provider of the Portal: the capabilities SchoolSoft only offers as
 * legacy web pages. Each method navigates (GET) to the page with the user's
 * cookies and runs a self-contained extractor inside it. Read-only by
 * construction: the session guard aborts every non-GET request.
 */
import type { BrowserSession } from "../browser/session.js";
import type { BrowserPortalPart } from "./composite.js";
import type { Booking, ContactGroup, PortalFile, SubjectRoom } from "./types.js";
import {
  extractBookings,
  extractContacts,
  extractFiles,
  extractSubjectLinks,
  extractSubjectTeachers,
} from "./extractors.js";

export const PAGES = {
  contacts: "/jsp/student/right_student_class.jsp",
  subjects: "/jsp/student/right_student_subject.jsp",
  bookings: "/jsp/student/right_student_timebooking.jsp",
  files: "/jsp/student/right_student_library.jsp",
} as const;

export interface BrowserPortalOptions {
  session: BrowserSession;
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
        rooms.push({ subject: link.subject, teachers, url: "/jsp/student/" + link.url });
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

  getFiles(): Promise<PortalFile[]> {
    return this.o.session.withPage(async (page) => {
      await page.goto(PAGES.files);
      return page.evaluate(extractFiles);
    });
  }
}
