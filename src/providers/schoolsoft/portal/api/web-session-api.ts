/**
 * REST endpoints that only answer the WEB login session (SchoolSoft's GDPR
 * gate): the header that says which child the web session shows, the PUT
 * that switches it (the portal's own child menu), and Avstämning. The web
 * session keeps its own child in focus, so gated reads align it first.
 */
import { SessionLostError, WebLoginRequiredError } from "../../../../core/portal/types.js";
import { UpstreamError } from "../../../../core/errors/index.js";
import type { SchoolsoftHttp } from "./transport.js";

/** Shape of GET /rest-api/parent/header/parent (web session): who is selected. */
interface WebHeader {
  currentChildId: number;
  currentOrgId: number;
}

export interface WebChild {
  childId: number;
  orgId: number;
}

export class WebSessionApi {
  constructor(
    private readonly http: SchoolsoftHttp,
    private readonly webCookieHeader: () => string | null,
    /** Which child the caller wants the web session on; null = leave it. */
    private readonly webChildTarget: () => WebChild | null,
  ) {}

  private cookieOr(capability: string): string {
    const cookie = this.webCookieHeader();
    if (!cookie) throw new WebLoginRequiredError(capability);
    return cookie;
  }

  private async webCookie<T>(capability: string, path: string): Promise<T> {
    return this.http.get<T>(path, { Cookie: this.cookieOr(capability) });
  }

  /** The web session's own child in focus. */
  async getWebChildInFocus(): Promise<WebChild> {
    const h = await this.webCookie<WebHeader>(
      "getWebChildInFocus",
      "/rest-api/parent/header/parent",
    );
    return { childId: h.currentChildId, orgId: h.currentOrgId };
  }

  /**
   * Select a child in the WEB session: the same PUT the portal's child menu
   * sends. It changes session state only (which child pages show), never
   * school data; it is the one non-GET the web session performs.
   */
  async focusWebChild(childId: number, orgId: number): Promise<void> {
    await Promise.resolve(); // reject, never throw synchronously
    const cookie = this.cookieOr("focusWebChild");
    const path = `/rest-api/parent/header/parent?childId=${childId}&orgId=${orgId}`;
    const status = await this.http.put(path, cookie);
    if (status === 401 || status === 403) throw new SessionLostError(path, true);
    if (status < 200 || status >= 300)
      throw new UpstreamError(status, `selecting child ${childId} in the web session`);
  }

  /** Align the web session's child with the wanted one (no-op when already there or no target). */
  async syncWebChild(): Promise<void> {
    const want = this.webChildTarget();
    if (!want) return;
    const cur = await this.getWebChildInFocus();
    if (cur.childId === want.childId && cur.orgId === want.orgId) return;
    await this.focusWebChild(want.childId, want.orgId);
  }

  /** Avstämning: reconciliation dates from the gated grade-prognosis REST. */
  async getGradePrognosis(): Promise<{ reconciliationDates: unknown }> {
    await this.syncWebChild();
    const reconciliationDates = await this.webCookie<unknown>(
      "getGradePrognosis",
      "/rest-api/parent/gradeprognosis/options/reconciliationdates",
    );
    return { reconciliationDates };
  }
}
