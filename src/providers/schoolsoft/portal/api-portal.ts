/**
 * API provider of the Portal: a facade over the four JSON backends a
 * guardian's SchoolSoft exposes, sharing one transport. Each backend is its
 * own class (api/*.ts) with its own credential; this file only composes
 * them into the ApiPortalPart the composite routes to.
 *
 *  - Eva (Bearer JWT): profile, lunch, news, messages, calendar.
 *  - Webview REST (app cookies, bound to childInFocus): schedule,
 *    assignments, subject rooms.
 *  - Legacy /rest (app cookies): activity log.
 *  - Web-session REST (web-login cookies): child header/switch, Avstämning.
 *  - Absence (app cookies): the one write, absence-notice; body unverified.
 *
 * Answers of the typed capabilities (profile, lunch, inbox, schedule,
 * calendar) are mapped to the domain model in `domain/`; drift throws.
 *
 * Verified live against Täby 2026-09-06; see docs/reference/schoolsoft-api.md.
 */
import type { ApiPortalPart } from "../../../core/portal/composite.js";
import type { CalendarEvent, Lesson, LunchDay, Message } from "../../../core/domain/schemas.js";
import type {
  AbsenceNotice,
  AbsenceReceipt,
  ActivityEntry,
  GuardianParent,
  SubjectRoom,
} from "../../../core/portal/types.js";
import { AbsenceApi } from "./api/absence-api.js";
import { SchoolsoftHttp, type ApiFetch } from "./api/transport.js";
import { EvaApi } from "./api/eva-api.js";
import { WebviewApi } from "./api/webview-api.js";
import { LegacyApi } from "./api/legacy-api.js";
import { WebSessionApi, type WebChild } from "./api/web-session-api.js";

export type { ApiFetch } from "./api/transport.js";

export interface GuardianApiOptions {
  beforeRead?: () => void;
  school: string;
  accessToken: () => string | null;
  cookieHeader: () => string | null;
  /** Cookies from a web login (needed for GDPR-gated REST endpoints). */
  webCookieHeader?: () => string | null;
  /**
   * Which child the caller wants the WEB session focused on (normally the
   * API session's child in focus). The web session keeps its own selection,
   * so gated reads first align it; null = leave the web session as it is.
   */
  webChildTarget?: () => WebChild | null;
  /** The budgeted HTTP helper (net.ts) in production, a fake in tests. */
  fetchImpl: ApiFetch;
  /** The host request's cancellation, for the budget's queue. */
  signal?: AbortSignal;
}

export class ApiPortal implements ApiPortalPart {
  readonly eva: EvaApi;
  readonly webview: WebviewApi;
  readonly legacy: LegacyApi;
  readonly webSession: WebSessionApi;
  readonly absence: AbsenceApi;

  constructor(o: GuardianApiOptions) {
    const http = new SchoolsoftHttp(o.school, o.fetchImpl, o.beforeRead, o.signal);
    this.eva = new EvaApi(http, o.accessToken);
    this.webview = new WebviewApi(http, o.cookieHeader);
    this.legacy = new LegacyApi(http, o.cookieHeader);
    this.absence = new AbsenceApi(http, o.cookieHeader);
    this.webSession = new WebSessionApi(
      http,
      () => o.webCookieHeader?.() ?? null,
      () => o.webChildTarget?.() ?? null,
    );
  }

  // Eva
  getParent(): Promise<GuardianParent> {
    return this.eva.getParent();
  }
  getLunchWeek(orgId: number, week: number, year: number): Promise<LunchDay[]> {
    return this.eva.getLunchWeek(orgId, week, year);
  }
  getNews(userId: number, orgId: number, studentId: number): Promise<unknown[]> {
    return this.eva.getNews(userId, orgId, studentId);
  }
  getInbox(userId: number, orgId: number): Promise<Message[]> {
    return this.eva.getInbox(userId, orgId);
  }
  getMessage(userId: number, orgId: number, messageId: number): Promise<unknown> {
    return this.eva.getMessage(userId, orgId, messageId);
  }
  getNextCalendarEvent(userId: number, orgId: number, studentId: number): Promise<unknown> {
    return this.eva.getNextCalendarEvent(userId, orgId, studentId);
  }

  // Webview REST
  getSession(): Promise<unknown> {
    return this.webview.getSession();
  }
  getCalendar(startDate: string, endDate: string): Promise<CalendarEvent[]> {
    return this.webview.getCalendar(startDate, endDate);
  }
  getScheduleWeek(week: number): Promise<Lesson[]> {
    return this.webview.getScheduleWeek(week);
  }
  getAssignmentsWeek(week: number, year: number): Promise<unknown[]> {
    return this.webview.getAssignmentsWeek(week, year);
  }
  getAssignmentDetail(id: number): Promise<{ view: unknown; sections: unknown }> {
    return this.webview.getAssignmentDetail(id);
  }
  getSubjectRooms(): Promise<SubjectRoom[]> {
    return this.webview.getSubjectRooms();
  }

  // Legacy /rest
  getActivityLog(limit?: number): Promise<ActivityEntry[]> {
    return this.legacy.getActivityLog(limit);
  }

  // Web-session REST
  getGradePrognosis(): Promise<{ reconciliationDates: unknown }> {
    return this.webSession.getGradePrognosis();
  }
  getWebChildInFocus(): Promise<WebChild> {
    return this.webSession.getWebChildInFocus();
  }
  focusWebChild(childId: number, orgId: number): Promise<void> {
    return this.webSession.focusWebChild(childId, orgId);
  }
  syncWebChild(): Promise<void> {
    return this.webSession.syncWebChild();
  }
  touchWebSession(): Promise<void> {
    return this.webSession.touch();
  }

  // Writes
  reportAbsence(notice: AbsenceNotice): Promise<AbsenceReceipt> {
    return this.absence.reportAbsence(notice);
  }
}

/** Backwards-compatible name. */
export const GuardianApi = ApiPortal;
export type GuardianApi = ApiPortal;
