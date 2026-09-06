/**
 * Production wiring (composition root of core): turns a resolved Config
 * into the object graph the adapters use, through the configured school
 * portal provider. This is the one core module allowed to import
 * src/providers; everything external is a dependency with a default here
 * and an injection point for tests.
 */
import type { Config } from "./config.js";
import { SessionManager } from "./session/session-manager.js";
import { FileSessionStore } from "./session/file-store.js";
import type { SessionStore } from "./session/store.js";
import { createCompositePortal, type BrowserPortalPart } from "./portal/composite.js";
import type { Portal } from "./portal/types.js";
import { childOf, orgIdOf } from "./portal/guardian.js";
import type { BrowserEngine } from "./browser/session.js";
import { PlaywrightSession, type PlaywrightLoader } from "./browser/playwright.js";
import { webLogin, type WebSession } from "./browser/web-login.js";
import type { ApiPortalContext, SchoolProvider } from "./provider/types.js";
import { getProvider } from "../providers/index.js";

export { getProvider, providerIds } from "../providers/index.js";

/** The provider a Config selects (throws for an unknown id). */
export function resolveProvider(config: Pick<Config, "provider">): SchoolProvider {
  return getProvider(config.provider);
}

export interface SessionDeps {
  store?: SessionStore;
  /** Injected HTTP for the provider's auth calls (tests). */
  fetchImpl?: unknown;
  openBrowser?: (url: string) => void;
  /** Override the interactive web login (tests); default opens a headed Playwright window. */
  webLogin?: (school: string) => Promise<WebSession>;
  playwrightLoader?: PlaywrightLoader;
}

/** Production wiring of a SessionManager for a resolved Config. */
export function createSessionManager(config: Config, deps: SessionDeps = {}): SessionManager {
  const provider = resolveProvider(config);
  return new SessionManager({
    school: config.school,
    provider: provider.id,
    store: deps.store ?? new FileSessionStore(config.stateDir),
    createSession: (school) => provider.createSession(school),
    serialize: (s) => provider.serializeSession(s),
    strategies: provider.createAuthStrategies(config, {
      fetchImpl: deps.fetchImpl,
      openBrowser: deps.openBrowser,
    }),
    webLogin:
      deps.webLogin ??
      ((school) =>
        webLogin({
          school,
          spec: provider.webLogin,
          engine:
            config.browser.kind === "cdp" ? config.browser : { kind: "chromium", headless: false },
          loader: deps.playwrightLoader,
          onOpen: (url) =>
            console.error(`Web login: complete BankID/SAML in the browser window (${url})`),
        })),
  });
}

/** Portal bound to the manager's live session: API provider always; browser provider when supplied. */
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
  const provider = getProvider(manager.providerId);
  const session = manager.getSession();
  return new PlaywrightSession({
    school: session.school,
    origin: provider.webLogin.origin,
    cookieHeader: () => session.cookieHeader(),
    webCookies: () => manager.getWebSession()?.cookies ?? null,
    engine: deps.engine,
    loader: deps.playwrightLoader,
  });
}

function apiContext(manager: SessionManager): ApiPortalContext {
  return {
    webCookieHeader: () => {
      const w = manager.getWebSession();
      return w ? w.cookies.map((c) => `${c.name}=${c.value}`).join("; ") : null;
    },
    webChildTarget: () => {
      try {
        const g = manager.guardian();
        return { childId: g.childInFocus, orgId: orgIdOf(childOf(g)) };
      } catch {
        return null;
      }
    },
  };
}

/** API provider bound to the manager's live session, app cookies and web-login cookies. */
export function createApiPortal(manager: SessionManager) {
  return getProvider(manager.providerId).createApiPortal(manager.getSession(), apiContext(manager));
}

export function createPortal(manager: SessionManager, deps: PortalDeps = {}): Portal {
  const provider = getProvider(manager.providerId);
  const api = createApiPortal(manager);
  const browser =
    deps.browser === undefined
      ? provider.createBrowserPortal(createBrowserSession(manager, deps), {
          hasWebSession: () => manager.getWebSession() !== null,
          syncWebChild: () => api.syncWebChild(),
        })
      : deps.browser;
  return createCompositePortal({
    routing: provider.routing,
    providerId: provider.id,
    api,
    browser,
    browserUnavailableReason: deps.browserUnavailableReason,
  });
}
