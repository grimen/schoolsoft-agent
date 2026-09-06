/**
 * BrowserSession is the port the browser provider of the Portal uses: give
 * me a page that carries the user's SchoolSoft web session, run this
 * function against it, and enforce read-only unless told otherwise.
 *
 * The implementation (playwright.ts) is the only place a browser engine is
 * touched; Chromium and CDP endpoints such as Obscura are interchangeable
 * behind it.
 */

/** The subset of a browser page the portal needs. Mirrors Playwright's Page. */
export interface PortalPage {
  /** Navigate to a path under the tenant (e.g. "/jsp/student/right_student_class.jsp"). */
  goto(path: string): Promise<void>;
  /** Run a self-contained function in the page (optionally with one JSON argument) and return its JSON-serialisable result. */
  evaluate<T, A = void>(fn: (arg: A) => T, arg?: A): Promise<T>;
  /** Current URL after navigation and redirects. */
  url(): string;
  /** Wait for a response whose URL matches, returning its JSON body. */
  waitForJson<T>(urlPattern: RegExp, timeoutMs?: number): Promise<T>;
}

export interface WithPageOptions {
  /**
   * Carry the web-login cookies (GDPR-gated pages) instead of the app
   * session cookies. The two sessions have separate "child in focus" state,
   * so only gated pages use the web one (see BrowserPortal.gated).
   */
  web?: boolean;
  /** Permit non-GET requests. Never set by read capabilities. */
  allowWrites?: boolean;
  /** Read-only POSTs the page legitimately performs (e.g. list fetches). */
  allowedNonGet?: RegExp[];
}

export interface BrowserSession {
  withPage<T>(fn: (page: PortalPage) => Promise<T>, options?: WithPageOptions): Promise<T>;
  close(): Promise<void>;
}

/** Engine behind the session. `cdp` connects to any Chrome DevTools Protocol endpoint (e.g. Obscura). */
export type BrowserEngine =
  { kind: "chromium"; headless?: boolean } | { kind: "cdp"; endpoint: string };
