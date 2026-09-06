/**
 * Web login: the user logs in through SchoolSoft's normal web page (SAML /
 * BankID) inside a browser window we open, and we keep that browser's
 * cookies. Only a session created this way passes SchoolSoft's GDPR gate on
 * grades, student documents and attendance; the app-token session does not.
 *
 * Nothing about the login is automated: the window is headed, the user does
 * everything, we only wait for the portal to appear and then read cookies.
 */
import type { BrowserEngine } from "./session.js";
import { defaultLoader, type PlaywrightLoader } from "./playwright.js";

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
  engine?: BrowserEngine;
  loader?: PlaywrightLoader;
  origin?: string;
  /** Give up after this long without a logged-in portal page. */
  timeoutMs?: number;
  /** Polling interval. */
  pollMs?: number;
  /** Called with the login URL so CLI/MCP can show it if the window is not visible. */
  onOpen?: (url: string) => void;
}

const LOGIN_MARKERS =
  /\/jsp\/Login\.jsp|\/samlLogin\.jsp|\/rest-api\/login\/|\/react\/#\/login|etjanst\.|\/wa\/auth\//;

/** True when a URL on the tenant is a portal page rather than any login step. */
export function isPortalUrl(url: string, origin: string, school: string): boolean {
  if (!url.startsWith(`${origin}/${school}/`)) return false;
  if (LOGIN_MARKERS.test(url)) return false;
  return /\/jsp\/(student|parent|teacher)\/|\/react\/#\/(parent|student)\//.test(url);
}

export async function webLogin(o: WebLoginOptions): Promise<WebSession> {
  const origin = o.origin ?? "https://sms.schoolsoft.se";
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
    const loginUrl = `${origin}/${o.school}/`;
    o.onOpen?.(loginUrl);
    await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const url = page.url();
      if (isPortalUrl(url, origin, o.school)) {
        const host = new URL(origin).hostname;
        const cookies = (await context.cookies()).filter(
          (c) => c.domain.replace(/^\./, "") === host,
        );
        if (cookies.some((c) => c.name === "JSESSIONID")) {
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
      `Web login timed out after ${Math.round(timeoutMs / 1000)} s without reaching the SchoolSoft portal. Run login --web again.`,
    );
  } finally {
    await browser.close().catch(() => {});
  }
}
