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
  type Capability,
  type ContactGroup,
} from "../../../core/portal/types.js";
import type {
  Booking,
  SharedFile,
  StudentDocument,
  TablePage,
} from "../../../core/domain/schemas.js";
import { toStudentDocuments, toTablePage } from "./domain/tables.js";
import { toBookings } from "./domain/bookings.js";
import { toSharedFiles } from "./domain/files.js";
import {
  extractBookings,
  extractContacts,
  extractFiles,
  extractSubjectLinks,
  extractTablePage,
  type PageTable,
} from "./extractors.js";
import type { PageSpec } from "../../../core/portal/page-spec.js";
import { PAGES } from "./pages.js";
import { AgentError } from "../../../core/errors/index.js";

export { PAGES } from "./pages.js";

export interface BrowserPortalOptions {
  session: BrowserSession;
  /** Whether a web-login session is stored; gated pages refuse to try without one. */
  hasWebSession?: () => boolean;
  /** Align the web session's child in focus with the requested child before a gated page. */
  syncWebChild?: () => Promise<void>;
}

/** A subject name for matching: case- and diacritic-insensitive, trimmed. */
export function normalizeSubject(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** Everyday names for subjects, normalized, to the start of the portal's name. */
export const SUBJECT_ALIASES: Readonly<Record<string, string>> = {
  matte: "matematik",
  eng: "engelska",
  idrott: "idrott och halsa",
  no: "naturorienterande",
  so: "samhallsorienterande",
};

/**
 * The menu entry a name means: the name exactly as the portal has it, else,
 * for the alias and then the name, a name that equals it, starts with it, or
 * contains it ("matte" finds "Matematik", "idrott" finds "Idrott och hälsa").
 */
export function matchSubject<T extends { subject: string }>(
  links: readonly T[],
  subject: string,
): T | undefined {
  const given = normalizeSubject(subject);
  const terms = Object.hasOwn(SUBJECT_ALIASES, given) ? [SUBJECT_ALIASES[given], given] : [given];
  const names = links.map((l) => normalizeSubject(l.subject));
  const rules = [
    (n: string, t: string) => n === t,
    (n: string, t: string) => n.startsWith(t),
    (n: string, t: string) => n.includes(t),
  ];
  const at = [
    names.indexOf(given),
    ...rules.flatMap((rule) => terms.map((t) => names.findIndex((n) => rule(n, t)))),
  ].find((i) => i !== -1);
  return at === undefined ? undefined : links[at];
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

  /** A gated page of tables, as the extractor lifted it (mapped by the caller). */
  private table(capability: Capability, spec: PageSpec, query = ""): Promise<PageTable> {
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

  /** The page's texts, parsed outside the page; text that does not parse is drift. */
  async getBookings(): Promise<Booking[]> {
    const texts = await this.visit("getBookings", PAGES.bookings, async (page) => {
      await page.goto(PAGES.bookings.path);
      return page.evaluate(extractBookings);
    });
    return toBookings(texts);
  }

  async getFiles(): Promise<SharedFile[]> {
    // Relative links resolve against the page they were on.
    const { links, base } = await this.visit("getFiles", PAGES.files, async (page) => {
      await page.goto(PAGES.files.path);
      return { links: await page.evaluate(extractFiles), base: page.url() };
    });
    return toSharedFiles(links, base);
  }

  async getGrades(): Promise<TablePage> {
    return toTablePage(await this.table("getGrades", PAGES.grades), "getGrades");
  }
  async getStudentDocuments(): Promise<StudentDocument[]> {
    return toStudentDocuments(await this.table("getStudentDocuments", PAGES.documents));
  }
  async getUnreportedAbsence(): Promise<TablePage> {
    return toTablePage(
      await this.table("getUnreportedAbsence", PAGES.unreportedAbsence),
      "getUnreportedAbsence",
    );
  }
  async getAttendanceReport(): Promise<TablePage> {
    return toTablePage(
      await this.table("getAttendanceReport", PAGES.attendanceReport),
      "getAttendanceReport",
    );
  }

  /**
   * Criteria for one subject, by name. The page takes SchoolSoft's internal
   * `requestid`, which only the subject menu exposes, so the menu is read
   * first in the same (web) session; ids never leak into the tool contract.
   */
  async getAssessmentCriteria(subject: string, schoolType = 7): Promise<TablePage> {
    const spec = PAGES.assessmentCriteria;
    // The JSP subject menu only renders under the app session (the web
    // session shows SchoolSoft's React sidebar), so resolve the id there.
    const links = await this.visit("getAssessmentCriteria", PAGES.subjects, async (page) => {
      await page.goto(PAGES.subjects.path);
      return page.evaluate(extractSubjectLinks);
    });
    const hit = matchSubject(links, subject);
    if (links.length === 0) throw new AgentError({ kind: "upstream", key: "subject_menu_empty" });
    if (!hit || hit.subjectId === null) {
      throw new AgentError({
        kind: "input",
        key: "subject_not_found",
        params: { subject, available: links.map((l) => l.subject).join(", ") },
        hint: "subject_rooms",
      });
    }
    const table = await this.table(
      "getAssessmentCriteria",
      spec,
      `?subject=${hit.subjectId}&schooltype=${schoolType}`,
    );
    return toTablePage({ ...table, title: table.title || hit.subject }, "getAssessmentCriteria");
  }
}
