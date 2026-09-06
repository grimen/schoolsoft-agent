/**
 * Exchange a SchoolSoft access token for the React-webview session cookies
 * (JSESSIONID + hash + usertype), which `/rest-api/parent/...` needs.
 *
 * Verified live (Täby, 2026-09-06): `/eva-apps/auth/login/parent` only
 * returns cookies when the request names the guardian's userId, the
 * school orgId and the child in focus (`childInFocus`). Without those it
 * 303s to `...?error=other` with no cookies. ssp-node's equivalent
 * (`mobileGetSession`) hardcodes the student path and none of these
 * headers, so it can never work for guardians. Header names follow
 * sebdanielsson/better-schoolsoft.
 */
import { schoolsoftFetch, ssUrl, extractCookie, type SchoolsoftClient } from "@elias4044/ssp-node";
import type { SchoolsoftUserType } from "../constants.js";

/** Minimal shape of ssp-node's schoolsoftFetch, injectable for tests. */
export type ExchangeFetch = (
  url: string,
  school: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    followRedirects?: boolean;
    responseType?: "json" | "text" | "buffer";
  },
  userAgent?: string,
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
  fetchImpl?: ExchangeFetch;
}

const APP_UA = "SchoolSoftPlus-Mobile/1.0";

export async function exchangeTokenForCookies(
  client: SchoolsoftClient,
  options: ExchangeOptions,
): Promise<void> {
  const token = client.accessToken;
  if (!token) {
    throw new Error("No access token on client — complete the login flow first.");
  }
  /* c8 ignore next: live default, exercised by make e2e (A1) */
  const fetchImpl = options.fetchImpl ?? (schoolsoftFetch as ExchangeFetch);
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

  const result = await fetchImpl(
    ssUrl(school, `/eva-apps/auth/login/${userType}`),
    school,
    { method: "GET", headers, followRedirects: false, responseType: "text" },
    APP_UA,
  );

  const jsessionid = extractCookie(result.setCookies, "JSESSIONID");
  const hash = extractCookie(result.setCookies, "hash");
  const usertype = extractCookie(result.setCookies, "usertype") ?? "1";
  if (!jsessionid || !hash) {
    const location = result.headers.location;
    throw new Error(
      `Session exchange failed for user type "${userType}" — SchoolSoft ` +
        `did not return JSESSIONID/hash cookies (status ${result.status}` +
        (location ? `, redirect ${String(location)}` : "") +
        `). The access token may be expired, or the user/org/child ids ` +
        `do not match this account.`,
    );
  }
  client.setSessionCookies(jsessionid, hash, usertype);
}
