/**
 * React webview REST (`/rest-api/parent/...`) with the APP session cookies
 * from the token → cookie exchange, bound to one child (childInFocus).
 * Schedule, assignments and the subject rooms behind the React Ämne view.
 */
import type { SubjectRoom } from "../../../../core/portal/types.js";
import type { SchoolsoftHttp } from "./transport.js";
import { AgentError } from "../../../../core/errors/index.js";

export class WebviewApi {
  constructor(
    private readonly http: SchoolsoftHttp,
    private readonly cookieHeader: () => string | null,
  ) {}

  private async cookie<T>(path: string): Promise<T> {
    const cookie = this.cookieHeader();
    if (!cookie)
      throw new AgentError({
        kind: "not_authenticated",
        key: "not_authenticated",
        params: { reason: "no session cookies" },
        hint: "login",
      });
    return this.http.get<T>(path, { Cookie: cookie });
  }

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

  /** Ämne: the room list, then each room's teachers. */
  async getSubjectRooms(): Promise<SubjectRoom[]> {
    const rooms = await this.cookie<
      { activityId: number; subject: string; groupNames?: string[]; isSubjectRoom?: boolean }[]
    >("/rest-api/parent/ps/subjectroom/all");
    return Promise.all(
      rooms
        .filter((r) => r.isSubjectRoom !== false)
        .map(async (r) => {
          const teachers = await this.cookie<{ firstName: string; lastName: string }[]>(
            `/rest-api/parent/ps/subjectroom/${r.activityId}/teachers`,
          );
          return {
            subject: r.subject,
            subjectId: r.activityId,
            groups: r.groupNames ?? [],
            teachers: teachers.map((t) => `${t.firstName} ${t.lastName}`.trim()),
          };
        }),
    );
  }
}
