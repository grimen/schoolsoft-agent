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
import { ApiPortal, type ApiFetch } from "./portal/api-portal.js";
import { BrowserPortal } from "./portal/browser-portal.js";
import { PAGES } from "./portal/pages.js";
import { FINGERPRINTS } from "./portal/fingerprints.js";
import { SchoolDirectory } from "./schools.js";
import { SchoolsoftSession } from "./session.js";
import { ROUTING, WEB_SESSION_CAPABILITIES } from "./routing.js";
import { webLoginSpec } from "./web-login.js";

export const schoolsoftProvider: SchoolProvider<SchoolsoftSession> = {
  id: "schoolsoft",
  displayName: "SchoolSoft",
  routing: ROUTING,
  webSessionCapabilities: WEB_SESSION_CAPABILITIES,
  pages: PAGES,
  fingerprints: FINGERPRINTS,
  webLogin: webLoginSpec,

  createSession: (school) => new SchoolsoftSession(school),
  serializeSession: (session) => ({ ...session.serialize() }),

  createAuthStrategies: (config: Config, deps) => [
    new BankIdBrowserStrategy({
      orgid: config.orgId,
      userType: config.userType,
      clientId: config.clientId,
      callbackPort: config.callbackPort,
      fetchImpl: deps.fetchImpl as BankIdBrowserOptions["fetchImpl"],
      openBrowser: deps.openBrowser,
      browserAuthorization: deps.browserAuthorization,
      redirectUri: deps.redirectUri,
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
      fetchImpl: ctx.fetchImpl as ApiFetch | undefined,
    }),

  createBrowserPortal: (browser, ctx) =>
    new BrowserPortal({
      session: browser,
      hasWebSession: ctx.hasWebSession,
      syncWebChild: ctx.syncWebChild,
    }),

  createSchoolDirectory: (cacheFile) => new SchoolDirectory({ cacheFile }),
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
export { SchoolDirectory, SCHOOL_LIST_URL, parseSchoolList, defaultFetch } from "./schools.js";
export * from "./portal/extractors.js";
