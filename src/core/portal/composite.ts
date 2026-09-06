/**
 * CompositePortal routes every capability to the first provider listed in
 * PROVIDERS. The browser provider is optional: when a browser-only capability
 * is called without one, the caller gets BrowserRequiredError with the
 * install hint instead of a stack trace.
 */
import { PROVIDERS, BrowserRequiredError, type Capability, type Portal } from "./types.js";

export type ApiPortalPart = Pick<
  Portal,
  Extract<
    Capability,
    | "getParent"
    | "getLunchWeek"
    | "getNews"
    | "getInbox"
    | "getMessage"
    | "getNextCalendarEvent"
    | "getSession"
    | "getScheduleWeek"
    | "getAssignmentsWeek"
    | "getAssignmentDetail"
    | "getActivityLog"
  >
>;
export type BrowserPortalPart = Pick<
  Portal,
  Extract<Capability, "getContacts" | "getSubjectRooms" | "getBookings" | "getFiles">
>;

export interface CompositePortalOptions {
  api: ApiPortalPart;
  /** Absent when Playwright is not installed / not configured. */
  browser?: BrowserPortalPart | null;
  /** Why the browser is absent, surfaced in the error (e.g. "playwright is not installed"). */
  browserUnavailableReason?: string;
}

export function createCompositePortal(o: CompositePortalOptions): Portal {
  const portal: Partial<Record<Capability, (...args: unknown[]) => Promise<unknown>>> = {};
  for (const capability of Object.keys(PROVIDERS) as Capability[]) {
    const provider = PROVIDERS[capability][0];
    portal[capability] = (...args: unknown[]) => {
      if (provider === "api") {
        const fn = (o.api as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[
          capability
        ];
        return fn.apply(o.api, args);
      }
      if (!o.browser) {
        return Promise.reject(new BrowserRequiredError(capability, o.browserUnavailableReason));
      }
      const fn = (o.browser as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[
        capability
      ];
      return fn.apply(o.browser, args);
    };
  }
  return portal as unknown as Portal;
}

/** Which provider serves a capability (for docs and diagnostics). */
export function providerOf(capability: Capability): "api" | "browser" {
  return PROVIDERS[capability][0];
}
