/**
 * Exchange a SchoolSoft OAuth access token for web session cookies
 * (JSESSIONID + hash), which every legacy REST/JSP endpoint needs.
 *
 * ssp-node's `mobileGetSession` does the same thing but hardcodes the
 * *student* endpoint (`/eva-apps/auth/login/student`). SchoolSoft resolves
 * the token's identity as the user type in the path, so guardians must hit
 * `/eva-apps/auth/login/parent` — verified live 2026-09-06: the student
 * path returned no cookies for a parent token, and an unauthenticated
 * probe shows `/parent` exists (303) while `/teacher` is 404.
 */
import {
  schoolsoftFetch,
  ssUrl,
  extractCookie,
  type SchoolsoftClient,
} from "@elias4044/ssp-node";
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
  /** SchoolSoft user id from fetchMobileSessionInfo(), if known. */
  userId?: number;
  orgid?: string;
  fetchImpl?: ExchangeFetch;
}

/** Mirrors the headers SchoolSoft's native app sends (from ssp-node). */
const APP_HEADERS = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "X-Requested-With": "com.schoolsoft.eapp.android",
  language: "sw",
  theme: "dark",
  useros: "android",
};
const APP_UA = "nyEva";

export async function exchangeTokenForCookies(
  client: SchoolsoftClient,
  options: ExchangeOptions,
): Promise<void> {
  const token = client.accessToken;
  if (!token) {
    throw new Error("No access token on client — complete the login flow first.");
  }
  const fetchImpl = options.fetchImpl ?? (schoolsoftFetch as ExchangeFetch);
  const { school } = client;
  const { userType } = options;

  const headers: Record<string, string> = {
    ...APP_HEADERS,
    token,
    redirecturl: `https://sms.schoolsoft.se/${school}/react/#/${userType}/start`,
  };
  if (options.orgid !== undefined) headers.orgid = options.orgid;
  if (options.userId !== undefined) headers.userid = String(options.userId);

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
        `). The access token may be expired, or ${userType} is not the ` +
        `right user type for this account.`,
    );
  }
  client.setSessionCookies(jsessionid, hash, usertype);
}
