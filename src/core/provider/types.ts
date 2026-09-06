/**
 * The provider seam: everything vendor-specific about a school portal is
 * behind this interface. Core owns the capability vocabulary (Portal), the
 * operations, the session lifecycle, the browser session guard and the
 * "BankID in the user's own browser" mechanics; a provider supplies the
 * concrete auth strategies, the API and browser portals, the pages it
 * reads and how to recognise its own login pages.
 */
import type { Config } from "../config.js";
import type { AuthStrategy } from "../auth/strategy.js";
import type { BrowserSession } from "../browser/session.js";
import type { WebCookie } from "../browser/web-login.js";
import type { ApiPortalPart, BrowserPortalPart } from "../portal/composite.js";
import type { PageFingerprint, PageMap } from "../portal/page-spec.js";
import type { Capability, PortalProvider } from "../portal/types.js";
import type { SchoolDirectoryPort } from "../school-directory.js";

/** What core needs from a provider's live session object (credentials holder). */
export interface ProviderSession {
  readonly school: string;
  /** Is the session still accepted upstream? */
  verify(): Promise<boolean>;
  /** Cookie header for the browser session with the app credentials, null when none. */
  cookieHeader(): string | null;
}

/** Test seams every provider's auth strategies accept. */
export interface AuthDeps {
  /** Injected HTTP for the provider's auth calls (tests). */
  fetchImpl?: unknown;
  /** Opens a URL in the user's browser; tests inject a callback simulator. */
  openBrowser?: (url: string) => void;
}

/** What a provider gets when building its API portal. */
export interface ApiPortalContext {
  /** Cookies from the web login, as a header, null without a web session. */
  webCookieHeader: () => string | null;
  /** Which child the caller wants the WEB session on; null = leave it. */
  webChildTarget: () => { childId: number; orgId: number } | null;
}

export interface BrowserPortalContext {
  hasWebSession: () => boolean;
  /** Align the provider's web session with the requested child before a gated page. */
  syncWebChild: () => Promise<void>;
}

/** Vendor-specific half of the headed-browser web login (cookie capture). */
export interface WebLoginSpec {
  /** Origin the portal is served from (cookies are filtered to its host). */
  origin: string;
  /** Where to open the login for a tenant. */
  loginUrl(school: string): string;
  /** True when a URL on the tenant is a portal page rather than any login step. */
  isPortalUrl(url: string, school: string): boolean;
}

export interface SchoolProvider<S extends ProviderSession = ProviderSession> {
  readonly id: string;
  readonly displayName: string;
  /** Provider order per capability; a capability absent here is not offered by this provider. */
  readonly routing: Partial<Record<Capability, readonly PortalProvider[]>>;
  /** Capabilities that need the web-login session, whichever provider serves them. */
  readonly webSessionCapabilities: readonly Capability[];
  /** Pages the browser provider reads, for `browser verify` and fingerprints. */
  readonly pages: PageMap;
  readonly fingerprints: Partial<Record<string, PageFingerprint>>;
  readonly webLogin: WebLoginSpec;

  createSession(school: string): S;
  /** Provider-owned persisted credentials (the `data` blob of a PersistedSession). */
  serializeSession(session: S): Record<string, unknown>;
  createAuthStrategies(config: Config, deps: AuthDeps): AuthStrategy<S>[];
  createApiPortal(
    session: S,
    ctx: ApiPortalContext,
  ): ApiPortalPart & { syncWebChild(): Promise<void> };
  createBrowserPortal(browser: BrowserSession, ctx: BrowserPortalContext): BrowserPortalPart;
  createSchoolDirectory(cacheFile: string): SchoolDirectoryPort;
  /** Web cookies filtered for the browser session; default keeps the provider origin's cookies. */
  webCookies?(cookies: WebCookie[]): WebCookie[];
}
