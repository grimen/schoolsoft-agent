/**
 * Web login: the user logs in through the portal's normal web page (SAML /
 * BankID) inside a browser window we open, and we keep that browser's
 * cookies. Only a session created this way passes login gates the app
 * session cannot (SchoolSoft's GDPR gate on grades and documents).
 *
 * Nothing about the login is automated: the window is headed, the user does
 * everything, we only wait for the portal to appear and then read cookies.
 * Which URL to open and what counts as "the portal appeared" come from the
 * provider (WebLoginSpec).
 */
import type { BrowserEngine } from "./session.js";
import { defaultLoader, type PlaywrightLoader } from "./playwright.js";
import type { WebLoginSpec } from "../provider/types.js";

export interface WebCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  /** Unix seconds, -1 for session cookies. */
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
}

export interface WebSession {
  cookies: WebCookie[];
  savedAt: number;
  /** URL the portal landed on after login (no query), for diagnostics. */
  landedOn: string;
}

export interface WebLoginOptions {
  school: string;
  /** Provider-specific: where to open, what a landed portal page looks like. */
  spec: WebLoginSpec;
  engine?: BrowserEngine;
  loader?: PlaywrightLoader;
  /** Give up after this long without a logged-in portal page. */
  timeoutMs?: number;
  /** Polling interval. */
  pollMs?: number;
  /** Called with the login URL so CLI/MCP can show it if the window is not visible. */
  onOpen?: (url: string) => void;
}

export async function webLogin(o: WebLoginOptions): Promise<WebSession> {
  const origin = o.spec.origin;
  /* c8 ignore next: real playwright default, exercised by make login-web */
  const loader = o.loader ?? defaultLoader;
  const engine = o.engine ?? { kind: "chromium", headless: false };
  const timeoutMs = o.timeoutMs ?? 5 * 60_000;
  const pollMs = o.pollMs ?? 500;
  const pw = await loader();
  const browser =
    engine.kind === "cdp"
      ? await pw.chromium.connectOverCDP(engine.endpoint)
      : await pw.chromium.launch({ headless: false });
  try {
    const context = await browser.newContext({ locale: "sv-SE" });
    const page = await context.newPage();
    const loginUrl = o.spec.loginUrl(o.school);
    o.onOpen?.(loginUrl);
    await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      // The identity provider may continue in a new tab or popup; watch every page.
      const url =
        context
          .pages()
          .map((p) => p.url())
          .find((u) => o.spec.isPortalUrl(u, o.school)) ?? page.url();
      if (o.spec.isPortalUrl(url, o.school)) {
        const host = new URL(origin).hostname;
        const cookies = (await context.cookies()).filter(
          (c) => c.domain.replace(/^\./, "") === host,
        );
        if (cookies.length > 0) {
          return {
            cookies: cookies.map((c) => ({
              name: c.name,
              value: c.value,
              domain: c.domain,
              path: c.path,
              expires: c.expires,
              httpOnly: c.httpOnly,
              secure: c.secure,
            })),
            savedAt: Date.now(),
            landedOn: url.split("?")[0],
          };
        }
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
    throw new Error(
      `Web login timed out after ${Math.round(timeoutMs / 1000)} s without reaching the school portal. Run login --web again.`,
    );
  } finally {
    await browser.close().catch(() => {});
  }
}
