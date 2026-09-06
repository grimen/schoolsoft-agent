/**
 * Interactive login flow designed for BankID.
 *
 * BankID cannot (and must not) be automated, so the strategy is:
 *
 *   1. Start a one-shot local HTTP server on 127.0.0.1:<port>/callback.
 *   2. Build SchoolSoft's OAuth2+PKCE auth URL (via ssp-node) with our
 *      localhost callback as redirect_uri, and open it in the user's
 *      default browser.
 *   3. The user authenticates however they like on the real SchoolSoft
 *      login page — BankID, password, SAML/SSO. We never see credentials.
 *   4. SchoolSoft redirects back with ?code=...&state=...; we verify
 *      state, exchange code+verifier for tokens, and shut the server down.
 *
 * ⚠️ OPEN QUESTION (verify live, see CLAUDE.md): SchoolSoft's OAuth server
 * may only whitelist the app deep-link `com.schoolsoftplus.app://` as
 * redirect_uri. If a localhost redirect is rejected, fall back to
 * FALLBACK_STRATEGIES documented at the bottom of this file.
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { platform } from "node:os";
import { SchoolsoftClient } from "@elias4044/ssp-node";
import { DEFAULT_CALLBACK_PORT, CALLBACK_PORT_ENV } from "../constants.js";

export interface BrowserFlowResult {
  code: string;
  verifier: string;
}

const SUCCESS_HTML = `<!doctype html><html lang="sv"><meta charset="utf-8">
<title>Inloggning klar</title>
<body style="font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center"><h1>✅ Inloggad</h1>
<p>Du kan stänga den här fliken och gå tillbaka till din AI-assistent.</p></div>
</body></html>`;

const ERROR_HTML = (msg: string) => `<!doctype html><html lang="sv"><meta charset="utf-8">
<title>Inloggning misslyckades</title>
<body style="font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center"><h1>❌ Något gick fel</h1><p>${msg}</p></div>
</body></html>`;

function defaultOpenInBrowser(url: string): void {
  const cmd =
    platform() === "darwin"
      ? ["open", url]
      : platform() === "win32"
        ? ["cmd", "/c", "start", "", url.replace(/&/g, "^&")]
        : ["xdg-open", url];
  const child = spawn(cmd[0], cmd.slice(1), {
    detached: true,
    stdio: "ignore",
  });
  // Without this, a missing opener binary crashes the process.
  child.on("error", (e) => {
    console.error(
      `Could not open browser automatically (${e.message}). ` +
        `Ask the user to open the login URL manually.`,
    );
  });
  child.unref();
}

/**
 * Runs the full interactive flow. Resolves with the authorization code
 * once the user has completed login (e.g. via BankID), or rejects on
 * timeout / state mismatch.
 */
export async function runBrowserLogin(options: {
  school: string;
  orgid?: string;
  timeoutMs?: number;
  /** Injectable for tests; defaults to opening the OS default browser. */
  openBrowser?: (url: string) => void;
}): Promise<{ result: BrowserFlowResult; authUrl: string }> {
  const openBrowser = options.openBrowser ?? defaultOpenInBrowser;
  const port = Number(
    process.env[CALLBACK_PORT_ENV] ?? DEFAULT_CALLBACK_PORT,
  );
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  const flow = SchoolsoftClient.startMobileFlow({
    school: options.school,
    orgid: options.orgid,
    redirectUri,
  });

  const code = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(
      () => {
        server.close();
        reject(
          new Error(
            "Login timed out after 5 minutes. Run schoolsoft_login again.",
          ),
        );
      },
      options.timeoutMs ?? 5 * 60 * 1000,
    );

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const err = url.searchParams.get("error");
      const gotState = url.searchParams.get("state");
      const gotCode = url.searchParams.get("code");

      if (err) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(ERROR_HTML(err));
        cleanup();
        reject(new Error(`SchoolSoft returned error: ${err}`));
        return;
      }
      if (gotState !== flow.state) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(ERROR_HTML("State mismatch — possible CSRF, try again."));
        cleanup();
        reject(new Error("OAuth state mismatch."));
        return;
      }
      if (!gotCode) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(ERROR_HTML("No authorization code in callback."));
        cleanup();
        reject(new Error("Callback missing code parameter."));
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(SUCCESS_HTML);
      cleanup();
      resolve(gotCode);

      function cleanup(): void {
        clearTimeout(timeout);
        // Give the response a moment to flush before closing.
        setTimeout(() => server.close(), 100);
      }
    });

    server.on("error", (e) => {
      clearTimeout(timeout);
      reject(
        new Error(
          `Could not start callback server on port ${port}: ${e.message}. ` +
            `Set ${CALLBACK_PORT_ENV} to a free port.`,
        ),
      );
    });

    server.listen(port, "127.0.0.1", () => {
      openBrowser(flow.authUrl);
    });
  });

  return {
    result: { code, verifier: flow.verifier },
    authUrl: flow.authUrl,
  };
}

/*
 * FALLBACK_STRATEGIES if localhost redirect_uri is rejected by SchoolSoft:
 *
 * A) Playwright-assisted: launch a real (headed) browser via Playwright,
 *    let the user complete BankID in it, and intercept the navigation to
 *    `com.schoolsoftplus.app://?code=...` before the OS tries to resolve
 *    the custom scheme. Requires playwright as an optional dependency.
 *
 * B) Cookie capture: as (A), but skip OAuth entirely — let the user log
 *    in to the *web* UI and harvest JSESSIONID+hash cookies from the
 *    browser context, then persist those. Shorter session lifetime, but
 *    always works since it's just the normal web login.
 *
 * C) One-time BankID bootstrap: after a manual web login, the user can
 *    (per SchoolSoft docs) see their username under "Min profil", set a
 *    password, and enable app access. Then `mobileLogin()` with
 *    username+password works headlessly, refresh tokens keep it alive,
 *    and BankID is never needed again.
 */
