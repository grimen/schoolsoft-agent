/**
 * The Portal is what an operation talks to: one method per capability a
 * guardian's SchoolSoft portal offers. Each capability declares, statically,
 * which providers can fulfil it, in order: the JSON APIs ("api") where they
 * exist, otherwise a headless browser over the legacy web pages ("browser").
 * Routing is deterministic (see composite.ts); the browser is never used for
 * something the API serves.
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
  // ----- browser: legacy JSP pages (no API) -----
  /** Kontaktlistor: the child's class list as the page shows it. */
  getContacts(): Promise<ContactGroup[]>;
  /** Ämne: subject rooms with teachers and links. */
  getSubjectRooms(): Promise<SubjectRoom[]>;
  /** Verksamhetslogg: activity log entries. */
  getActivityLog(): Promise<ActivityEntry[]>;
  /** Bokningar: bookable / booked meeting slots (read only). */
  getBookings(): Promise<Booking[]>;
  /** Alla filer & länkar: shared files and links. */
  getFiles(): Promise<PortalFile[]>;
}

export type Capability = keyof Portal;

/** Provider order per capability. Every Portal method must appear here. */
export const PROVIDERS: Record<Capability, readonly PortalProvider[]> = {
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
  getContacts: ["browser"],
  getSubjectRooms: ["browser"],
  getActivityLog: ["browser"],
  getBookings: ["browser"],
  getFiles: ["browser"],
};

export const API_CAPABILITIES = (Object.keys(PROVIDERS) as Capability[]).filter((c) =>
  PROVIDERS[c].includes("api"),
);
export const BROWSER_CAPABILITIES = (Object.keys(PROVIDERS) as Capability[]).filter(
  (c) => !PROVIDERS[c].includes("api"),
);

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
  teachers: string[];
  url: string;
}
export interface ActivityEntry {
  date: string;
  title: string;
  author?: string;
  text: string;
}
export interface Booking {
  title: string;
  description?: string;
  slots: { start: string; end?: string; status: "available" | "booked" | "closed" | "unknown" }[];
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
  constructor(page: string) {
    super(
      `SchoolSoft redirected ${page} to the login page: the web session expired. Retry (it re-authenticates silently) or run login.`,
    );
    this.name = "SessionLostError";
  }
}
