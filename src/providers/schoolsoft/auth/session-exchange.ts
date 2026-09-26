/**
 * Exchange a SchoolSoft access token for the React-webview session cookies
 * (JSESSIONID + hash + usertype), which `/rest-api/parent/...` needs.
 *
 * Verified live (Täby, 2026-09-06): `/eva-apps/auth/login/parent` only
 * returns cookies when the request names the guardian's userId, the
 * school orgId and the child in focus (`childInFocus`). Without those it
 * 303s to `...?error=other` with no cookies. The student client
 * libraries use the student path and none of these headers, so they can
 * never work for guardians. Header names follow
 * sebdanielsson/better-schoolsoft. The cookies come with the 303 itself,
 * so this request never follows it.
 */
import type { SchoolsoftUserType } from "../../../core/constants.js";
import { AgentError, guardNetwork } from "../../../core/errors/index.js";
import type { FetchOptions } from "../net.js";
import type { SessionTokens } from "../tokens.js";
import { portalUrl } from "../web-login.js";

/** Minimal shape of the provider's HTTP helper (net.ts, budgeted), injectable for tests. */
export type ExchangeFetch = (
  url: string,
  school: string,
  options: FetchOptions,
  userAgent: string,
) => Promise<{
  status: number;
  data: unknown;
  headers: Record<string, string | string[] | undefined>;
  setCookies: string[];
}>;

export interface ExchangeOptions {
  userType: SchoolsoftUserType;
  userId: number;
  orgId: number;
  /** Student the cookie session should be bound to (guardians). */
  childInFocus?: number;
  fetchImpl: ExchangeFetch;
}

const APP_UA = "SchoolSoftPlus-Mobile/1.0";

/** The value of the named cookie in a list of `Set-Cookie` headers (the first one), or null. */
function cookieValue(setCookies: string[], name: string): string | null {
  const line = setCookies.map((c) => c.trim()).find((c) => c.startsWith(`${name}=`));
  return line === undefined ? null : line.slice(name.length + 1).split(";")[0];
}

export async function exchangeTokenForCookies(
  client: SessionTokens,
  options: ExchangeOptions,
): Promise<void> {
  const token = client.accessToken;
  if (!token) {
    throw new AgentError({
      kind: "not_authenticated",
      key: "not_authenticated",
      params: { reason: "no access token yet" },
      hint: "login",
    });
  }
  const { fetchImpl } = options;
  const { school } = client;
  const { userType } = options;

  const headers: Record<string, string> = {
    token,
    userId: String(options.userId),
    orgId: String(options.orgId),
    userOS: "android",
    language: "sw",
    redirecturl: `https://sms.schoolsoft.se/${school}/react/#/${userType}/start`,
  };
  if (options.childInFocus !== undefined) {
    headers.childInFocus = String(options.childInFocus);
  }

  const result = await guardNetwork(() =>
    fetchImpl(
      portalUrl(school, `/eva-apps/auth/login/${userType}`),
      school,
      { method: "GET", headers, redirect: "manual", responseType: "text" },
      APP_UA,
    ),
  );

  const jsessionid = cookieValue(result.setCookies, "JSESSIONID");
  const hash = cookieValue(result.setCookies, "hash");
  const usertype = cookieValue(result.setCookies, "usertype") ?? "1";
  if (!jsessionid || !hash) {
    throw new AgentError({
      kind: "not_authenticated",
      key: "cookie_exchange_failed",
      params: {
        userType,
        status: result.status,
        location:
          result.headers.location === undefined ? undefined : String(result.headers.location),
      },
      hint: "login",
    });
  }
  client.setSessionCookies(jsessionid, hash, usertype);
}
