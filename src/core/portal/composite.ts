/**
 * CompositePortal routes every capability to the first provider listed in
 * the school provider's routing table. The browser provider is optional: when a browser-only capability
 * is called without one, the caller gets BrowserRequiredError with the
 * install hint instead of a stack trace.
 */
import {
  CAPABILITIES,
  BrowserRequiredError,
  CapabilityNotSupportedError,
  type Capability,
  type CapabilityRouting,
  type Portal,
} from "./types.js";

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
    | "getCalendar"
    | "getAssignmentsWeek"
    | "getAssignmentDetail"
    | "getActivityLog"
    | "getSubjectRooms"
    | "getGradePrognosis"
  >
>;
export type BrowserPortalPart = Pick<
  Portal,
  Extract<
    Capability,
    | "getContacts"
    | "getBookings"
    | "getFiles"
    | "getGrades"
    | "getStudentDocuments"
    | "getUnreportedAbsence"
    | "getAttendanceReport"
    | "getAssessmentCriteria"
  >
>;

export interface CompositePortalOptions {
  /** Provider order per capability (SchoolProvider.routing). */
  routing: CapabilityRouting;
  /** Provider id, named in the error for capabilities it does not offer. */
  providerId?: string;
  api: ApiPortalPart;
  /** Absent when Playwright is not installed / not configured. */
  browser?: BrowserPortalPart | null;
  /** Why the browser is absent, surfaced in the error (e.g. "playwright is not installed"). */
  browserUnavailableReason?: string;
}

export function createCompositePortal(o: CompositePortalOptions): Portal {
  const portal: Partial<Record<Capability, (...args: unknown[]) => Promise<unknown>>> = {};
  for (const capability of CAPABILITIES) {
    const provider = o.routing[capability]?.[0];
    portal[capability] = (...args: unknown[]) => {
      if (!provider) {
        return Promise.reject(
          new CapabilityNotSupportedError(capability, o.providerId ?? "unknown"),
        );
      }
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

/** Which provider serves a capability (for docs and diagnostics); null when not offered. */
export function providerOf(
  routing: CapabilityRouting,
  capability: Capability,
): "api" | "browser" | null {
  return routing[capability]?.[0] ?? null;
}
