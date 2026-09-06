/**
 * The Portal is what an operation talks to: one method per capability a
 * guardian's school portal offers, vendor-neutral. Each provider declares,
 * statically, which of its backends can fulfil a capability, in order:
 * its JSON APIs ("api") where they exist, otherwise a headless browser
 * over its web pages ("browser"). Routing is deterministic (see
 * composite.ts); the browser is never used for something an API serves.
 */

export type PortalProvider = "api" | "browser";

/** Contract for every capability. Return shapes are documented per method. */
export interface Portal {
  // ----- api: Eva (Bearer) -----
  getParent(): Promise<GuardianParent>;
  getLunchWeek(orgId: number, week: number): Promise<unknown[]>;
  getNews(userId: number, orgId: number, studentId: number): Promise<unknown[]>;
  getInbox(userId: number, orgId: number): Promise<unknown[]>;
  getMessage(userId: number, orgId: number, messageId: number): Promise<unknown>;
  getNextCalendarEvent(userId: number, orgId: number, studentId: number): Promise<unknown>;
  // ----- api: webview REST (cookies) -----
  getSession(): Promise<unknown>;
  getScheduleWeek(week: number): Promise<unknown[]>;
  getAssignmentsWeek(week: number, year: number): Promise<unknown[]>;
  getAssignmentDetail(id: number): Promise<{ view: unknown; sections: unknown }>;
  /** Verksamhetslogg: activity log entries (legacy /rest endpoint, read-only POST with cookies). */
  getActivityLog(limit?: number): Promise<ActivityEntry[]>;
  // ----- browser: legacy JSP pages (no API) -----
  /** Kontaktlistor: the child's class list as the page shows it. */
  getContacts(): Promise<ContactGroup[]>;
  /** Ämne: subject rooms with teachers and links. */
  getSubjectRooms(): Promise<SubjectRoom[]>;
  /** Bokningar: bookable / booked meeting slots (read only). */
  getBookings(): Promise<Booking[]>;
  /** Alla filer & länkar: shared files and links. */
  getFiles(): Promise<PortalFile[]>;
  // ----- browser + WEB session: SchoolSoft's GDPR-gated pages -----
  /** Betyg: grade tables (empty until the school publishes grades). */
  getGrades(): Promise<TablePage>;
  /** Elevdokument: student documents (title, created by, date, link). */
  getStudentDocuments(): Promise<TablePage>;
  /** Oanmäld frånvaro: unreported absence, or the "nothing to show" message. */
  getUnreportedAbsence(): Promise<TablePage>;
  /** Rapport: attendance report for the default week range. */
  getAttendanceReport(): Promise<TablePage>;
  /** Kriterier för bedömning: assessment criteria matrix for one subject. */
  /** Criteria for one subject, matched by name (case/diacritic-insensitive). */
  getAssessmentCriteria(subject: string, schoolType?: number): Promise<TablePage>;
  /** Avstämning: grade prognosis reconciliation dates (gated REST, web session). */
  getGradePrognosis(): Promise<{ reconciliationDates: unknown }>;
}

export type Capability = keyof Portal;

/** Every capability, for runtime iteration; the type test keeps it in step with the Portal interface. */
export const CAPABILITIES: readonly Capability[] = [
  "getParent",
  "getLunchWeek",
  "getNews",
  "getInbox",
  "getMessage",
  "getNextCalendarEvent",
  "getSession",
  "getScheduleWeek",
  "getAssignmentsWeek",
  "getAssignmentDetail",
  "getActivityLog",
  "getContacts",
  "getSubjectRooms",
  "getBookings",
  "getFiles",
  "getGrades",
  "getStudentDocuments",
  "getUnreportedAbsence",
  "getAttendanceReport",
  "getAssessmentCriteria",
  "getGradePrognosis",
];

/** Provider order per capability, declared by each SchoolProvider. */
export type CapabilityRouting = Partial<Record<Capability, readonly PortalProvider[]>>;

// ----- shapes returned by browser capabilities -----

export interface ContactPerson {
  name: string;
  role: string;
  email?: string;
  phone?: string;
}
export interface ContactGroup {
  title: string;
  people: ContactPerson[];
}
export interface SubjectRoom {
  subject: string;
  /** SchoolSoft subject-room id (`activityId` in the REST API). */
  subjectId: number;
  /** Class / group names the room belongs to. */
  groups: string[];
  teachers: string[];
}

/** A server-rendered page made of tables: what the gated pages are. */
export interface TablePage {
  title: string;
  /** Informational text shown instead of, or above, the tables (e.g. "nothing to show"). */
  message?: string;
  sections: TableSection[];
}
export interface TableSection {
  heading?: string;
  headers: string[];
  rows: { cells: string[]; url?: string }[];
}
export interface ActivityEntry {
  id: number;
  /** ISO datetime. */
  date: string;
  title: string;
  author?: string;
  /** Post body (text blocks), or the summary when the post has no text block. */
  text: string;
  summary?: string;
  images?: number;
  recipients?: string;
  comments: number;
}
export interface Booking {
  title: string;
  description?: string;
  slots: { start: string; end?: string; status: "available" | "booked" | "closed" | "unknown" }[];
  /** Label/value pairs shown beside the booking (e.g. status), as the page words them. */
  info?: Record<string, string>;
}
export interface PortalFile {
  name: string;
  category?: string;
  url: string;
  type: "file" | "link";
}

// ----- shapes shared with the API portal -----

export interface GuardianChildSchool {
  orgId: number;
  name: string;
  className: string;
}
export interface GuardianChild {
  studentId: number;
  firstName: string;
  lastName: string;
  schools: GuardianChildSchool[];
}
export interface GuardianParent {
  userId: number;
  firstName: string;
  lastName: string;
  children: GuardianChild[];
}

// ----- errors -----

export const BROWSER_INSTALL_HINT =
  'This needs the headless browser: run "schoolsoft-agent browser install" once (downloads Chromium), or point SCHOOLSOFT_BROWSER_CDP at a CDP endpoint.';

/** A GDPR-gated capability was requested without a web-login session. */
export class WebLoginRequiredError extends Error {
  constructor(capability: string) {
    super(
      `${capability} is behind SchoolSoft's "log in again" gate and needs a web login session: run "schoolsoft-agent login --web" (or the login tool with web: true) once, then retry.`,
    );
    this.name = "WebLoginRequiredError";
  }
}

/** A browser-only capability was requested but no browser session is available. */
export class BrowserRequiredError extends Error {
  constructor(capability: string, reason?: string) {
    super(
      `${capability} is only available through the SchoolSoft web pages. ${BROWSER_INSTALL_HINT}${reason ? ` (${reason})` : ""}`,
    );
    this.name = "BrowserRequiredError";
  }
}

/** The page redirected to SchoolSoft's "log in again" gate (GDPR-protected content). */
export class PortalGatedError extends Error {
  constructor(page: string) {
    super(
      `SchoolSoft requires a fresh web login to show ${page}; it is not reachable with the app session.`,
    );
    this.name = "PortalGatedError";
  }
}

/** The page redirected to the login page: the cookie session is gone. */
export class SessionLostError extends Error {
  constructor(page: string, web = false) {
    super(
      web
        ? `SchoolSoft redirected ${page} to the login page: the web login session expired (inactivity). Run "schoolsoft-agent login --web" again.`
        : `SchoolSoft redirected ${page} to the login page: the web session expired. Retry (it re-authenticates silently) or run login.`,
    );
    this.name = "SessionLostError";
  }
}

export class CapabilityNotSupportedError extends Error {
  constructor(capability: string, provider: string) {
    super(`${capability} is not offered by the "${provider}" school portal provider.`);
    this.name = "CapabilityNotSupportedError";
  }
}
