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

import type { ActivityEntry, GuardianChild, GuardianParent } from "./types.js";
export type { GuardianChild, GuardianChildSchool, GuardianParent } from "./types.js";

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

export class ApiPortal {
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

  /** Cookie-authenticated JSON POST used by legacy /rest endpoints for READ queries only. */
  private async cookiePost<T>(path: string, body: unknown): Promise<T> {
    const cookie = this.o.cookieHeader();
    if (!cookie) throw new Error("No session cookies — log in first.");
    const r = await this.fetchImpl(
      ssUrl(this.o.school, path),
      this.o.school,
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          Accept: "application/json",
          "Content-Type": "application/json;charset=UTF-8",
        },
        body: JSON.stringify(body),
        responseType: "json",
      } as never,
      MOBILE_UA,
    );
    if (r.status === 401 || r.status === 403)
      throw new Error(`SchoolSoft rejected the session (HTTP ${r.status}) for ${path}.`);
    if (r.status !== 200) throw new Error(`SchoolSoft returned HTTP ${r.status} for ${path}.`);
    return r.data as T;
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
    return this.bearer<unknown[]>(`/eva/api/v1/parent/${userId}/schools/${orgId}/messages/inbox`);
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

  /**
   * Verksamhetslogg. The page's own query: a generic filter with paging. Read-only
   * despite the verb (observed 2026-09-06: `POST /rest/blogpost/getbyloggedinuser`).
   */
  async getActivityLog(limit = 20): Promise<ActivityEntry[]> {
    interface Block {
      blockType: string;
      contentBlocks?: { content?: string }[];
    }
    interface Row {
      blogPost: { id: number; creDate: number | string; name: string; description: string };
      author?: string;
      recipientsNamesString?: string;
      numberOfComments?: number;
      content?: { contentBlockDTOList?: Block[] }[];
    }
    const rows = await this.cookiePost<Row[]>("/rest/blogpost/getbyloggedinuser", {
      userId: -1,
      userType: -1,
      week: -1,
      subjects: [],
      archives: [],
      tags: [],
      freeText: "",
      goalIds: [],
      groupOrStudent: "",
      offset: 0,
      row_count: limit,
    });
    const strip = (html: string) =>
      html
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    return (Array.isArray(rows) ? rows : []).map((r) => {
      const blocks = (r.content ?? []).flatMap((c) => c.contentBlockDTOList ?? []);
      const bodyText = blocks
        .filter((b) => b.blockType === "text")
        .flatMap((b) => (b.contentBlocks ?? []).map((cb) => strip(cb.content ?? "")))
        .filter(Boolean)
        .join("\n");
      const images = blocks
        .filter((b) => b.blockType === "image")
        .reduce((n, b) => n + (b.contentBlocks?.length ?? 0), 0);
      const cre = r.blogPost.creDate;
      const date = typeof cre === "number" ? new Date(cre).toISOString() : String(cre);
      const summary = strip(r.blogPost.description ?? "");
      return {
        id: r.blogPost.id,
        date,
        title: r.blogPost.name,
        ...(r.author ? { author: r.author } : {}),
        text: bodyText || summary,
        ...(summary && bodyText && summary !== bodyText ? { summary } : {}),
        ...(images ? { images } : {}),
        ...(r.recipientsNamesString ? { recipients: r.recipientsNamesString } : {}),
        comments: r.numberOfComments ?? 0,
      };
    });
  }

  async getAssignmentDetail(id: number): Promise<{ view: unknown; sections: unknown }> {
    const [view, sections] = await Promise.all([
      this.cookie<unknown>(`/rest-api/parent/ps/assignments/${id}/view`),
      this.cookie<unknown>(`/rest-api/parent/ps/assignments/${id}/sections`).catch(() => null),
    ]);
    return { view, sections };
  }
}

/** Backwards-compatible name. */
export const GuardianApi = ApiPortal;
export type GuardianApi = ApiPortal;
