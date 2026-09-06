/**
 * Eva (`/eva/api/v1|v2/...`): the native app's API, Bearer token (JWT with
 * `user_type: PARENT`). Parent profile + children, lunch, news, messages,
 * calendar events. Verified live against Täby 2026-09-06.
 */
import type { GuardianParent } from "../../../../core/portal/types.js";
import type { SchoolsoftHttp } from "./transport.js";

export class EvaApi {
  constructor(
    private readonly http: SchoolsoftHttp,
    private readonly accessToken: () => string | null,
  ) {}

  private async bearer<T>(path: string): Promise<T> {
    const token = this.accessToken();
    if (!token) throw new Error("No access token — log in first.");
    return this.http.get<T>(path, { Authorization: `Bearer ${token}` });
  }

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
}
