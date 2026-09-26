/**
 * SchoolSoft as a SchoolProvider: BankID through SchoolSoft's OAuth login in
 * the user's own browser, Eva + webview REST + legacy REST as the API
 * backends, legacy JSP pages through the headless browser, the web-login
 * session for the GDPR-gated pages. Everything SchoolSoft-specific lives
 * under this directory; core only sees the SchoolProvider interface.
 *
 * SchoolSoft is a trademark of SchoolSoft AB, which is not involved in
 * this project.
 */
import type { SchoolProvider } from "../../core/provider/types.js";
import type { Config } from "../../core/config.js";
import { BankIdBrowserStrategy, type BankIdBrowserOptions } from "./auth/bankid-browser.js";
import { ApiPortal } from "./portal/api-portal.js";
import { BrowserPortal } from "./portal/browser-portal.js";
import { PAGES } from "./portal/pages.js";
import { FINGERPRINTS } from "./portal/fingerprints.js";
import { SchoolDirectory } from "./schools.js";
import { SchoolsoftSession } from "./session.js";
import { ROUTING, WEB_SESSION_CAPABILITIES } from "./routing.js";
import { webLoginSpec } from "./web-login.js";
import { budgetedFetch, budgetedHead, budgetedJson, type HeadFetch } from "./net.js";

export const schoolsoftProvider: SchoolProvider<SchoolsoftSession> = {
  id: "schoolsoft",
  displayName: "SchoolSoft",
  routing: ROUTING,
  webSessionCapabilities: WEB_SESSION_CAPABILITIES,
  pages: PAGES,
  fingerprints: FINGERPRINTS,
  webLogin: webLoginSpec,
  // A parent's use is a handful of requests a minute; see docs/planning/specs/2026-09-26-request-budget.md.
  requestBudget: { perMinute: 20, burst: 10, maxInFlight: 2 },

  // Every entry point wraps the fetch it is given (a test fake too) in the process's budget.
  createSession: (school, ctx) =>
    new SchoolsoftSession(school, budgetedFetch(ctx.budget, ctx.fetchImpl)),
  serializeSession: (session) => ({ ...session.serialize() }),

  createAuthStrategies: (config: Config, deps) => [
    new BankIdBrowserStrategy({
      orgid: config.orgId,
      userType: config.userType,
      clientId: config.clientId,
      callbackPort: config.callbackPort,
      fetchImpl: budgetedFetch(deps.budget, deps.fetchImpl) as BankIdBrowserOptions["fetchImpl"],
      openBrowser: deps.openBrowser,
      browserAuthorization: deps.browserAuthorization,
      redirectUri: deps.redirectUri,
      onRefresh: deps.onRefresh,
    }),
  ],

  createApiPortal: (session, ctx) =>
    new ApiPortal({
      school: session.school,
      accessToken: () => session.client.accessToken,
      cookieHeader: () => session.cookieHeader(),
      beforeRead: ctx.beforeRead,
      webCookieHeader: ctx.webCookieHeader,
      webChildTarget: ctx.webChildTarget,
      fetchImpl: budgetedFetch(ctx.budget, ctx.fetchImpl),
      signal: ctx.signal,
    }),

  createBrowserPortal: (browser, ctx) =>
    new BrowserPortal({
      session: browser,
      hasWebSession: ctx.hasWebSession,
      syncWebChild: ctx.syncWebChild,
    }),

  createSchoolDirectory: (cacheFile, budget) =>
    new SchoolDirectory({ cacheFile, fetchImpl: budgetedJson(budget) }),

  probeReachability: (budget, fetchImpl) =>
    budgetedHead(budget, fetchImpl as HeadFetch | undefined),
};

export { SchoolsoftSession } from "./session.js";
export {
  ROUTING,
  WEB_SESSION_CAPABILITIES,
  API_CAPABILITIES,
  BROWSER_CAPABILITIES,
} from "./routing.js";
export { isPortalUrl, SCHOOLSOFT_ORIGIN } from "./web-login.js";
export { PAGES, PAGE_KEYS, type PageKey } from "./portal/pages.js";
export { FINGERPRINTS } from "./portal/fingerprints.js";
export { BrowserPortal, normalizeSubject } from "./portal/browser-portal.js";
export {
  ApiPortal,
  GuardianApi,
  type GuardianApiOptions,
  type ApiFetch,
} from "./portal/api-portal.js";
export { EvaApi } from "./portal/api/eva-api.js";
export { WebviewApi } from "./portal/api/webview-api.js";
export { LegacyApi } from "./portal/api/legacy-api.js";
export { WebSessionApi } from "./portal/api/web-session-api.js";
export { SchoolsoftHttp } from "./portal/api/transport.js";
export { BankIdBrowserStrategy } from "./auth/bankid-browser.js";
export { decodeJwtClaims, buildAuthUrl, exchangeCode, refreshTokens } from "./auth/oauth.js";
export { runBrowserLogin } from "./auth/browser-flow.js";
export { SchoolDirectory, SCHOOL_LIST_URL, parseSchoolList } from "./schools.js";
export { budgetedFetch, budgetedJson, budgetedHead, type SchoolsoftFetch } from "./net.js";
export * from "./portal/extractors.js";
