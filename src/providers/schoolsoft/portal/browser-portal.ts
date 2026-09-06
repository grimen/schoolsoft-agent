/**
 * Browser provider of the Portal: the capabilities SchoolSoft only offers as
 * legacy web pages. Each method visits a page declared in pages.ts (GET,
 * with the user's cookies) and runs a self-contained extractor inside it.
 * Read-only by construction: the session guard aborts every non-GET request.
 */
import type { BrowserSession, PortalPage } from "../../../core/browser/session.js";
import type { BrowserPortalPart } from "../../../core/portal/composite.js";
import {
  WebLoginRequiredError,
  type Booking,
  type ContactGroup,
  type PortalFile,
  type TablePage,
} from "../../../core/portal/types.js";
import {
  extractBookings,
  extractContacts,
  extractFiles,
  extractSubjectLinks,
  extractTablePage,
} from "./extractors.js";
import type { PageSpec } from "../../../core/portal/page-spec.js";
import { PAGES } from "./pages.js";

export { PAGES } from "./pages.js";

export interface BrowserPortalOptions {
  session: BrowserSession;
  /** Whether a web-login session is stored; gated pages refuse to try without one. */
  hasWebSession?: () => boolean;
  /** Align the web session's child in focus with the requested child before a gated page. */
  syncWebChild?: () => Promise<void>;
}

/** Case- and diacritic-insensitive subject name match ("matte" finds "Matematik"). */
export function normalizeSubject(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export class BrowserPortal implements BrowserPortalPart {
  constructor(private readonly o: BrowserPortalOptions) {}

  /** Visit one page and run its extractor; gated pages get the web cookies after the child sync. */
  private async visit<T>(
    capability: string,
    spec: PageSpec,
    run: (page: PortalPage) => Promise<T>,
  ): Promise<T> {
    if (spec.web) {
      if (this.o.hasWebSession && !this.o.hasWebSession())
        throw new WebLoginRequiredError(capability);
      await this.o.syncWebChild?.();
    }
    return this.o.session.withPage(run, { web: spec.web });
  }

  private table(capability: string, spec: PageSpec, query = ""): Promise<TablePage> {
    return this.visit(capability, spec, async (page) => {
      await page.goto(spec.path + query);
      return page.evaluate(extractTablePage);
    });
  }

  getContacts(): Promise<ContactGroup[]> {
    return this.visit("getContacts", PAGES.contacts, async (page) => {
      await page.goto(PAGES.contacts.path);
      return page.evaluate(extractContacts);
    });
  }

  getBookings(): Promise<Booking[]> {
    return this.visit("getBookings", PAGES.bookings, async (page) => {
      await page.goto(PAGES.bookings.path);
      return page.evaluate(extractBookings);
    });
  }

  getFiles(): Promise<PortalFile[]> {
    return this.visit("getFiles", PAGES.files, async (page) => {
      await page.goto(PAGES.files.path);
      return page.evaluate(extractFiles);
    });
  }

  getGrades(): Promise<TablePage> {
    return this.table("getGrades", PAGES.grades);
  }
  getStudentDocuments(): Promise<TablePage> {
    return this.table("getStudentDocuments", PAGES.documents);
  }
  getUnreportedAbsence(): Promise<TablePage> {
    return this.table("getUnreportedAbsence", PAGES.unreportedAbsence);
  }
  getAttendanceReport(): Promise<TablePage> {
    return this.table("getAttendanceReport", PAGES.attendanceReport);
  }

  /**
   * Criteria for one subject, by name. The page takes SchoolSoft's internal
   * `requestid`, which only the subject menu exposes, so the menu is read
   * first in the same (web) session; ids never leak into the tool contract.
   */
  async getAssessmentCriteria(subject: string, schoolType = 7): Promise<TablePage> {
    const spec = PAGES.assessmentCriteria;
    const wanted = normalizeSubject(subject);
    // The JSP subject menu only renders under the app session (the web
    // session shows SchoolSoft's React sidebar), so resolve the id there.
    const links = await this.visit("getAssessmentCriteria", PAGES.subjects, async (page) => {
      await page.goto(PAGES.subjects.path);
      return page.evaluate(extractSubjectLinks);
    });
    const hit =
      links.find((l) => normalizeSubject(l.subject) === wanted) ??
      links.find((l) => normalizeSubject(l.subject).includes(wanted));
    if (!hit || hit.subjectId === null) {
      throw new Error(
        `No subject matching "${subject}" for this child. Available: ${links.map((l) => l.subject).join(", ") || "(none)"}.`,
      );
    }
    const table = await this.table(
      "getAssessmentCriteria",
      spec,
      `?subject=${hit.subjectId}&schooltype=${schoolType}`,
    );
    return { ...table, title: table.title || hit.subject };
  }
}
