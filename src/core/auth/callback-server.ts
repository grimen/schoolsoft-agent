/**
 * The vendor-neutral half of "BankID in the user's own browser": open an
 * auth URL, run a one-shot localhost HTTP server, and hand back the
 * `code` the identity provider redirects to it, after checking `state`.
 * Nothing about the login is automated; the user completes BankID (or
 * any other method) on the real login page. Providers build the URL.
 */
import { createServer } from "node:http";
import { defaultOpenInBrowser } from "./open-browser.js";

export const DEFAULT_CALLBACK_PORT = 43117;

const SUCCESS_HTML = `<!doctype html><html lang="sv"><meta charset="utf-8">
<title>Inloggning klar</title>
<body style="font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center"><h1>✅ Inloggad</h1>
<p>Du kan stänga den här fliken och gå tillbaka till din AI-assistent.</p></div>
</body></html>`;

/** The error text comes from the redirect's query string: never echo it unescaped (CodeQL js/reflected-xss). */
const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );

const ERROR_HTML = (msg: string) => `<!doctype html><html lang="sv"><meta charset="utf-8">
<title>Inloggning misslyckades</title>
<body style="font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center"><h1>❌ Något gick fel</h1><p>${escapeHtml(msg)}</p></div>
</body></html>`;

export interface CallbackOptions {
  /** URL to open; must redirect back to http://127.0.0.1:<port>/callback?code=…&state=…. */
  authUrl: string;
  /** The `state` the auth URL carries; the callback must echo it. */
  expectedState: string;
  /** Localhost port to listen on; the provider decides the default. */
  port: number;
  timeoutMs?: number;
  /** Injectable for tests; defaults to opening the OS default browser. */
  openBrowser?: (url: string) => void;
}

/** Resolves with the authorization code, rejects on timeout, error or state mismatch. */
export function awaitCallbackCode(options: CallbackOptions): Promise<string> {
  /* c8 ignore next: the real opener would launch the user's browser */
  const openBrowser = options.openBrowser ?? defaultOpenInBrowser;
  const { port } = options;
  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(
      () => {
        server.close();
        reject(new Error("Login timed out after 5 minutes. Run schoolsoft_login again."));
      },
      options.timeoutMs ?? 5 * 60 * 1000,
    );

    const server = createServer((req, res) => {
      const url = new URL(req.url as string, `http://127.0.0.1:${port}`);
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const err = url.searchParams.get("error");
      const gotState = url.searchParams.get("state");
      const gotCode = url.searchParams.get("code");
      const html = (body: string) => {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(body);
        clearTimeout(timeout);
        // Give the response a moment to flush before closing.
        setTimeout(() => server.close(), 100);
      };
      if (err) {
        html(ERROR_HTML(err));
        reject(new Error(`Identity provider returned error: ${err}`));
        return;
      }
      if (gotState !== options.expectedState) {
        html(ERROR_HTML("State mismatch — possible CSRF, try again."));
        reject(new Error("OAuth state mismatch."));
        return;
      }
      if (!gotCode) {
        html(ERROR_HTML("No authorization code in callback."));
        reject(new Error("Callback missing code parameter."));
        return;
      }
      html(SUCCESS_HTML);
      resolve(gotCode);
    });

    server.on("error", (e) => {
      clearTimeout(timeout);
      reject(
        new Error(
          `Could not start callback server on port ${port}: ${e.message}. ` +
            `Configure a free callbackPort.`,
        ),
      );
    });

    server.listen(port, "127.0.0.1", () => {
      openBrowser(options.authUrl);
    });
  });
}
