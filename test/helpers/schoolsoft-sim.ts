/**
 * An offline stand-in for SchoolSoft's HTTP endpoints, for tests that go
 * through the production wiring (createSessionManager, createPortals,
 * createKeepalive): token refresh with rotation, guardian profile, cookie
 * exchange bound to a child, reads that echo the child's cookie, and the
 * web-session header. Everything is synthetic; nothing touches the network.
 */
import type { PersistedSession } from "../../src/core/index.js";

export function jwt(expSeconds: number): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ exp: expSeconds })}.sig`;
}

export interface SimResponse {
  status: number;
  data: unknown;
  headers: Record<string, string>;
  setCookies: string[];
}

export class SchoolsoftSim {
  /** Every request as "METHOD path-and-query". */
  readonly requests: string[] = [];
  refreshes = 0;
  /** Status the token endpoint answers (200 rotates the pair). */
  refreshStatus = 200;
  /** Status of the guardian profile lookup. */
  parentStatus = 200;
  /** What the web-session header GET answers. */
  webHeader: { status: number; data: unknown } = {
    status: 200,
    data: { currentChildId: 100, currentOrgId: 20 },
  };
  /** Throw this instead of answering (a network failure). */
  failWith: Error | null = null;
  /** Called on every data read, before it answers. */
  onRead: (() => void | Promise<void>) | null = null;

  constructor(private readonly now: () => number) {}

  /** Data reads only (schedule, lunch, ...), as "path-and-query". */
  readonly reads: string[] = [];

  readonly fetch = async (
    url: string,
    _school: string,
    request: { method?: string; headers?: Record<string, string> },
  ): Promise<SimResponse> => {
    const { pathname, search } = new URL(url);
    this.requests.push(`${request.method ?? "GET"} ${pathname}${search}`);
    if (this.failWith) throw this.failWith;
    const answer = (status: number, data: unknown, setCookies: string[] = []): SimResponse => ({
      status,
      data,
      headers: {},
      setCookies,
    });
    if (pathname.endsWith("/rest-api/login/token")) {
      if (this.refreshStatus !== 200) return answer(this.refreshStatus, { userMessage: "nej" });
      this.refreshes++;
      return answer(200, {
        access_token: jwt(Math.floor(this.now() / 1000) + 900),
        refresh_token: `refresh-${this.refreshes}`,
      });
    }
    if (pathname.endsWith("/eva/api/v1/parent")) {
      if (this.parentStatus !== 200) return answer(this.parentStatus, null);
      return answer(200, {
        userId: 21,
        firstName: "Parent",
        lastName: "Test",
        children: [100, 101].map((studentId) => ({
          studentId,
          firstName: `Child ${studentId}`,
          lastName: "T",
          schools: [{ orgId: 20, name: "School", className: "1A" }],
        })),
      });
    }
    if (pathname.includes("/eva-apps/auth/")) {
      const child = request.headers!.childInFocus;
      return answer(303, "", [`JSESSIONID=${child}; Path=/`, "hash=h; Path=/"]);
    }
    if (pathname.endsWith("/rest-api/parent/header/parent")) {
      return answer(this.webHeader.status, this.webHeader.data);
    }
    this.reads.push(`${pathname}${search}`);
    await this.onRead?.();
    return answer(200, [`${request.headers?.Cookie ?? "bearer"} #${this.requests.length}`]);
  };
}

/** A saved session as the BankID strategy persists it, valid for `ttlSeconds` from `nowMs`. */
export function savedSession(nowMs: number, ttlSeconds = 900): PersistedSession {
  const exp = Math.floor(nowMs / 1000) + ttlSeconds;
  return {
    provider: "schoolsoft",
    school: "taby",
    data: { accessToken: jwt(exp), refreshToken: "refresh-0", accessTokenExpiresAt: exp },
    savedAt: nowMs,
    authMethod: "bankid-browser",
  };
}
