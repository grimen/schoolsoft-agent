/**
 * Playwright-backed BrowserSession. Playwright is an optional dependency and
 * is imported lazily on first use; when it is missing the caller gets
 * BrowserRequiredError with the install hint.
 *
 * Safety, enforced here rather than promised:
 *  - every non-GET request is aborted unless the caller allowed writes or
 *    the URL matches an explicit read-only allowlist;
 *  - a navigation that lands on the login page or SchoolSoft's "log in
 *    again" gate throws SessionLostError / PortalGatedError instead of
 *    being followed (loading Login.jsp invalidates the cookie session).
 */
import type { Browser, BrowserContext, Page, Route } from "playwright";
import { BrowserRequiredError, PortalGatedError, SessionLostError } from "../portal/types.js";
import type { BrowserEngine, BrowserSession, PortalPage, WithPageOptions } from "./session.js";

/** The slice of the playwright module we use; injectable for tests. */
export interface PlaywrightLike {
  chromium: {
    launch(o: { headless: boolean }): Promise<Browser>;
    connectOverCDP(endpoint: string): Promise<Browser>;
  };
}

export type PlaywrightLoader = () => Promise<PlaywrightLike>;

export const defaultLoader: PlaywrightLoader = async () => {
  try {
    return (await import("playwright")) as unknown as PlaywrightLike;
  } catch (e) {
    throw new BrowserRequiredError(
      "browser",
      `playwright is not installed: ${(e as Error).message}`,
    );
  }
};

export interface PlaywrightSessionOptions {
  school: string;
  /** Fresh cookie header on every page: the session may have been refreshed. */
  cookieHeader: () => string | null;
  engine?: BrowserEngine;
  loader?: PlaywrightLoader;
  origin?: string;
}

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export class PlaywrightSession implements BrowserSession {
  private browser: Browser | null = null;
  private readonly engine: BrowserEngine;
  private readonly loader: PlaywrightLoader;
  private readonly origin: string;

  constructor(private readonly o: PlaywrightSessionOptions) {
    this.engine = o.engine ?? { kind: "chromium", headless: true };
    this.loader = o.loader ?? defaultLoader;
    this.origin = o.origin ?? "https://sms.schoolsoft.se";
  }

  private async getBrowser(): Promise<Browser> {
    if (this.browser) return this.browser;
    const pw = await this.loader();
    this.browser =
      this.engine.kind === "cdp"
        ? await pw.chromium.connectOverCDP(this.engine.endpoint)
        : await pw.chromium.launch({ headless: this.engine.headless ?? true });
    return this.browser;
  }

  async withPage<T>(
    fn: (page: PortalPage) => Promise<T>,
    options: WithPageOptions = {},
  ): Promise<T> {
    const cookie = this.o.cookieHeader();
    if (!cookie) throw new SessionLostError("(no web session cookies)");
    const browser = await this.getBrowser();
    const context: BrowserContext = await browser.newContext({ locale: "sv-SE" });
    try {
      const origin = new URL(this.origin);
      const host = origin.hostname;
      // Cookies only make sense for an http(s) origin; fixtures load from file://.
      if (origin.protocol.startsWith("http"))
        await context.addCookies(
          cookie
            .split(";")
            .map((p) => p.trim())
            .filter(Boolean)
            .map((p) => {
              const i = p.indexOf("=");
              return { name: p.slice(0, i), value: p.slice(i + 1), domain: host, path: "/" };
            }),
        );
      const page = await context.newPage();
      // Bundlers (tsx/esbuild keepNames) decorate serialised function sources
      // with `__name(fn, "name")`; give the page an identity helper so
      // extractors run unchanged in dev and in the built package.
      await page.addInitScript("globalThis.__name = globalThis.__name || ((f) => f);");
      await page.route("**/*", (route: Route) => {
        const req = route.request();
        if (READ_METHODS.has(req.method())) return route.continue();
        if (options.allowWrites) return route.continue();
        if (options.allowedNonGet?.some((re) => re.test(req.url()))) return route.continue();
        return route.abort("blockedbyclient");
      });
      return await fn(this.wrap(page));
    } finally {
      await context.close().catch(() => {});
      // One browser per call: a lingering Chromium would keep the CLI / MCP
      // process alive after the operation finished (and cost memory between
      // calls). Launch cost is paid once per operation, not per page.
      await this.close();
    }
  }

  private wrap(page: Page): PortalPage {
    const base = `${this.origin}/${this.o.school}`;
    return {
      goto: async (path: string) => {
        await page.goto(base + path, { waitUntil: "networkidle", timeout: 30_000 });
        const landed = page.url();
        if (/\/jsp\/Login\.jsp/.test(landed)) throw new SessionLostError(path);
        if (/right_student_app_blocked\.jsp/.test(landed)) throw new PortalGatedError(path);
      },
      evaluate: <T>(fn: () => T) => page.evaluate(fn),
      url: () => page.url(),
      waitForJson: async <T>(urlPattern: RegExp, timeoutMs = 30_000) => {
        const res = await page.waitForResponse((r) => urlPattern.test(r.url()), {
          timeout: timeoutMs,
        });
        return (await res.json()) as T;
      },
    };
  }

  async close(): Promise<void> {
    const b = this.browser;
    this.browser = null;
    if (b) await b.close().catch(() => {});
  }
}
