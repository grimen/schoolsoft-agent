/**
 * The vendor-neutral half of "BankID in the user's own browser": open an
 * auth URL, run a one-shot localhost HTTP server, and hand back the
 * `code` the identity provider redirects to it, after checking `state`.
 * Nothing about the login is automated; the user completes BankID (or
 * any other method) on the real login page. Providers build the URL.
 */
import { createServer } from "node:http";
import { defaultOpenInBrowser } from "./open-browser.js";
import { AgentError } from "../errors/index.js";

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

/**
 * Resolves with the authorization code; rejects on timeout or when the redirect that
 * carries the expected state reports an error or no code. A request without that state
 * is refused and the wait goes on.
 */
export function awaitCallbackCode(options: CallbackOptions): Promise<string> {
  /* c8 ignore next: the real opener would launch the user's browser */
  const openBrowser = options.openBrowser ?? defaultOpenInBrowser;
  const { port } = options;
  const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000;
  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.close();
      reject(
        new AgentError({
          kind: "not_authenticated",
          key: "login_timeout",
          params: { minutes: Math.round(timeoutMs / 60_000) },
          hint: "login",
        }),
      );
    }, timeoutMs);

    const server = createServer((req, res) => {
      const url = new URL(req.url as string, `http://127.0.0.1:${port}`);
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const err = url.searchParams.get("error");
      const gotState = url.searchParams.get("state");
      const gotCode = url.searchParams.get("code");
      const page = (status: number, body: string) => {
        res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
        res.end(body);
      };
      const finish = (body: string) => {
        page(200, body);
        clearTimeout(timeout);
        // Give the response a moment to flush before closing.
        setTimeout(() => server.close(), 100);
      };
      // Only the redirect that carries this login's state may end it. Anything else on
      // this port (another page in the browser, a stale tab, a local process) is answered
      // and ignored, so it can neither complete nor cancel the login the user is in.
      if (gotState !== options.expectedState) {
        page(400, ERROR_HTML(err ?? "This request does not belong to the login in progress."));
        return;
      }
      if (err) {
        finish(ERROR_HTML(err));
        reject(
          new AgentError({
            kind: "not_authenticated",
            key: "login_denied",
            params: { error: err },
            hint: "login",
          }),
        );
        return;
      }
      if (!gotCode) {
        finish(ERROR_HTML("No authorization code in callback."));
        reject(new AgentError({ kind: "not_authenticated", key: "login_no_code", hint: "login" }));
        return;
      }
      finish(SUCCESS_HTML);
      resolve(gotCode);
    });

    server.on("error", (e) => {
      clearTimeout(timeout);
      reject(
        new AgentError({
          kind: "not_available",
          key: "callback_port_busy",
          params: { port, detail: e.message },
          hint: "free_port",
          cause: e,
        }),
      );
    });

    server.listen(port, "127.0.0.1", () => {
      openBrowser(options.authUrl);
    });
  });
}
