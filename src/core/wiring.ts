/**
 * Production wiring (composition root of core): turns a resolved Config
 * into the object graph the adapters use. Everything external is a
 * dependency with a default here and an injection point for tests:
 * store, fetch, browser opener, web login, playwright loader.
 */
import type { Config } from "./config.js";
import { SessionManager } from "./session/session-manager.js";
import { FileSessionStore } from "./session/file-store.js";
import type { SessionStore } from "./session/store.js";
import { BankIdBrowserStrategy, type BankIdBrowserOptions } from "./auth/bankid-browser.js";
import { ApiPortal } from "./portal/api-portal.js";
import { childOf, orgIdOf } from "./portal/guardian.js";
import { createCompositePortal, type BrowserPortalPart } from "./portal/composite.js";
import type { Portal } from "./portal/types.js";
import type { BrowserEngine } from "./browser/session.js";
import { PlaywrightSession, type PlaywrightLoader } from "./browser/playwright.js";
import { BrowserPortal } from "./portal/browser-portal.js";
import { webLogin, type WebSession } from "./browser/web-login.js";

export interface SessionDeps {
  store?: SessionStore;
  fetchImpl?: BankIdBrowserOptions["fetchImpl"];
  openBrowser?: BankIdBrowserOptions["openBrowser"];
  /** Override the interactive web login (tests); default opens a headed Playwright window. */
  webLogin?: (school: string) => Promise<WebSession>;
  playwrightLoader?: PlaywrightLoader;
}

/** Production wiring of a SessionManager for a resolved Config. */
export function createSessionManager(config: Config, deps: SessionDeps = {}): SessionManager {
  return new SessionManager({
    school: config.school,
    store: deps.store ?? new FileSessionStore(config.stateDir),
    webLogin:
      deps.webLogin ??
      ((school) =>
        webLogin({
          school,
          engine:
            config.browser.kind === "cdp" ? config.browser : { kind: "chromium", headless: false },
          loader: deps.playwrightLoader,
          onOpen: (url) =>
            console.error(`Web login: complete BankID/SAML in the browser window (${url})`),
        })),
    strategies: [
      new BankIdBrowserStrategy({
        orgid: config.orgId,
        userType: config.userType,
        clientId: config.clientId,
        callbackPort: config.callbackPort,
        fetchImpl: deps.fetchImpl,
        openBrowser: deps.openBrowser,
      }),
    ],
  });
}

/** Portal bound to the manager's live client: API provider always; browser provider when supplied. */
export interface PortalDeps {
  /** Explicit browser provider; null disables the browser (tests, --no-browser). */
  browser?: BrowserPortalPart | null;
  browserUnavailableReason?: string;
  /** Engine for the default PlaywrightSession; defaults to config.browser. */
  engine?: BrowserEngine;
  playwrightLoader?: PlaywrightLoader;
}
/** The browser session bound to the manager's live cookies (app) and its web-login cookies (gated pages). */
export function createBrowserSession(
  manager: SessionManager,
  deps: Pick<PortalDeps, "engine" | "playwrightLoader"> = {},
): PlaywrightSession {
  const client = manager.getClient();
  return new PlaywrightSession({
    school: client.school,
    cookieHeader: () => {
      try {
        return client.cookieHeader;
      } catch {
        return null;
      }
    },
    webCookies: () => manager.getWebSession()?.cookies ?? null,
    engine: deps.engine,
    loader: deps.playwrightLoader,
  });
}

/** API provider bound to the manager's live client, app cookies and web-login cookies. */
export function createApiPortal(manager: SessionManager): ApiPortal {
  const client = manager.getClient();
  const webCookieHeader = () => {
    const w = manager.getWebSession();
    return w ? w.cookies.map((c) => `${c.name}=${c.value}`).join("; ") : null;
  };
  const webChildTarget = () => {
    try {
      const g = manager.guardian();
      return { childId: g.childInFocus, orgId: orgIdOf(childOf(g)) };
    } catch {
      return null;
    }
  };
  const api = new ApiPortal({
    webChildTarget,
    webCookieHeader,
    school: client.school,
    accessToken: () => client.accessToken,
    cookieHeader: () => {
      try {
        return client.cookieHeader;
      } catch {
        return null;
      }
    },
  });
  return api;
}

export function createPortal(manager: SessionManager, deps: PortalDeps = {}): Portal {
  const api = createApiPortal(manager);
  const browser =
    deps.browser === undefined
      ? new BrowserPortal({
          hasWebSession: () => manager.getWebSession() !== null,
          syncWebChild: () => api.syncWebChild(),
          session: createBrowserSession(manager, deps),
        })
      : deps.browser;
  return createCompositePortal({
    api,
    browser,
    browserUnavailableReason: deps.browserUnavailableReason,
  });
}
