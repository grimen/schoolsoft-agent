/**
 * Guardian ("vårdnadshavare") data access, verified live against Täby
 * 2026-09-06. Two backends are involved:
 *
 *  - **Eva** (`/eva/api/v1|v2/...`): the native app's API. Bearer token
 *    (JWT with `user_type: PARENT`, `aud: eva-backend`). Serves parent
 *    profile + children, lunch, news, messages, calendar events.
 *  - **React webview REST** (`/rest-api/parent/...`): needs the session
 *    cookies from `src/auth/session-exchange.ts`, which are bound to one
 *    child ("childInFocus"). Serves schedule and assignments.
 *
 * ssp-node only covers student endpoints, so nothing here uses it beyond
 * its HTTP helpers. Endpoint shapes follow sebdanielsson/better-schoolsoft
 * (MIT), the only other guardian implementation found.
 */
import { schoolsoftFetch, ssUrl } from "@elias4044/ssp-node";

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

/** What we persist between runs so tools know whose data they serve. */
export interface GuardianContext {
  userId: number;
  parentName: string;
  children: GuardianChild[];
  /** studentId the session cookies are currently bound to. */
  childInFocus: number;
}

export function childOf(ctx: GuardianContext, studentId = ctx.childInFocus): GuardianChild {
  const child = ctx.children.find((c) => c.studentId === studentId);
  if (!child) {
    throw new Error(
      `Unknown child id ${studentId}. Known children: ` +
        ctx.children.map((c) => `${c.studentId} (${c.firstName})`).join(", "),
    );
  }
  return child;
}

export function orgIdOf(child: GuardianChild): number {
  const org = child.schools[0]?.orgId;
  if (org === undefined) throw new Error(`Child ${child.studentId} has no school`);
  return org;
}

/** Minimal shape of ssp-node's schoolsoftFetch, injectable for tests. */
export type ApiFetch = (
  url: string,
  school: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    responseType?: "json" | "text" | "buffer";
  },
  userAgent?: string,
) => Promise<{ status: number; data: unknown }>;

export interface GuardianApiOptions {
  school: string;
  accessToken: () => string | null;
  cookieHeader: () => string | null;
  fetchImpl?: ApiFetch;
}

const MOBILE_UA = "SchoolSoftPlus-Mobile/1.0";

export class GuardianApi {
  private readonly fetchImpl: ApiFetch;
  constructor(private readonly o: GuardianApiOptions) {
    this.fetchImpl = o.fetchImpl ?? (schoolsoftFetch as ApiFetch);
  }

  private async bearer<T>(path: string): Promise<T> {
    const token = this.o.accessToken();
    if (!token) throw new Error("No access token — log in first.");
    return this.get<T>(path, { Authorization: `Bearer ${token}` });
  }

  private async cookie<T>(path: string): Promise<T> {
    const cookie = this.o.cookieHeader();
    if (!cookie) throw new Error("No session cookies — log in first.");
    return this.get<T>(path, { Cookie: cookie });
  }

  private async get<T>(path: string, headers: Record<string, string>): Promise<T> {
    const r = await this.fetchImpl(
      ssUrl(this.o.school, path),
      this.o.school,
      { headers: { ...headers, Accept: "application/json" }, responseType: "json" },
      MOBILE_UA,
    );
    if (r.status === 401 || r.status === 403) {
      throw new Error(`SchoolSoft rejected the session (HTTP ${r.status}) for ${path}.`);
    }
    if (r.status !== 200) {
      throw new Error(`SchoolSoft returned HTTP ${r.status} for ${path}.`);
    }
    return r.data as T;
  }

  // ----- Eva (Bearer) -------------------------------------------------

  getParent(): Promise<GuardianParent> {
    return this.bearer<GuardianParent>("/eva/api/v1/parent");
  }

  getLunchWeek(orgId: number, week: number): Promise<unknown[]> {
    return this.bearer<unknown[]>(`/eva/api/v1/schools/${orgId}/lunchmenu/${week}`);
  }

  getNews(userId: number, orgId: number, studentId: number): Promise<unknown[]> {
    return this.bearer<unknown[]>(
      `/eva/api/v2/parent/${userId}/schools/${orgId}/news?studentId=${studentId}&langId=1`,
    );
  }

  getInbox(userId: number, orgId: number): Promise<unknown[]> {
    return this.bearer<unknown[]>(
      `/eva/api/v1/parent/${userId}/schools/${orgId}/messages/inbox`,
    );
  }

  getMessage(userId: number, orgId: number, messageId: number): Promise<unknown> {
    return this.bearer<unknown>(
      `/eva/api/v1/parent/${userId}/schools/${orgId}/messages/${messageId}`,
    );
  }

  getNextCalendarEvent(userId: number, orgId: number, studentId: number): Promise<unknown> {
    return this.bearer<unknown>(
      `/eva/api/v1/parent/${userId}/schools/${orgId}/news/calendarevent/next?studentId=${studentId}`,
    );
  }

  // ----- React webview REST (cookies, bound to childInFocus) ----------

  getSession(): Promise<unknown> {
    return this.cookie<unknown>("/rest-api/session");
  }

  getScheduleWeek(week: number): Promise<unknown[]> {
    return this.cookie<unknown[]>(`/rest-api/parent/calendar/lessons/week/${week}`);
  }

  getAssignmentsWeek(week: number, year: number): Promise<unknown[]> {
    return this.cookie<unknown[]>(
      `/rest-api/parent/ps/assignments/start-page?week=${week}&year=${year}`,
    );
  }

  async getAssignmentDetail(id: number): Promise<{ view: unknown; sections: unknown }> {
    const [view, sections] = await Promise.all([
      this.cookie<unknown>(`/rest-api/parent/ps/assignments/${id}/view`),
      this.cookie<unknown>(`/rest-api/parent/ps/assignments/${id}/sections`).catch(() => null),
    ]);
    return { view, sections };
  }
}
