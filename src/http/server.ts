/* oxlint-disable oxc/no-async-endpoint-handlers -- Express 5 forwards rejected promises; http-owner.test.ts verifies sanitized failures. */
/** HTTP transport and owner-only routes. School data is accessed only through the runtime. */
import express, { type Request, type Response, type NextFunction } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { operations } from "../core/index.js";
import type { ConnectorConfig } from "./config.js";
import type { ConnectorOAuthProvider } from "./oauth.js";
import type { ConnectorRuntime } from "./runtime.js";
import { OwnerSessions } from "./owner-session.js";
import { escapeHtml as esc, page, form, hidden } from "./pages.js";
export interface ServerOptions {
  config: ConnectorConfig;
  oauth: ConnectorOAuthProvider;
  runtime: Pick<ConnectorRuntime, "beginLogin" | "callback" | "status" | "execute" | "logout">;
  sessions?: OwnerSessions;
}
export function createConnectorApp({
  config,
  oauth,
  runtime,
  sessions = new OwnerSessions(config.adminPassword),
}: ServerOptions) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.proxyHops ?? 1);
  app.use((_req, res, next) => {
    res.set({
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy":
        "default-src 'none'; form-action 'self' https://claude.ai https://chatgpt.com; frame-ancestors 'none'; base-uri 'none'",
      "Strict-Transport-Security": "max-age=31536000",
    });
    next();
  });
  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });
  app.use((req, res, next) => {
    if (req.headers.host !== new URL(config.publicUrl).host) {
      res.status(421).end();
      return;
    }
    next();
  });
  app.use(express.urlencoded({ extended: false, limit: "16kb" }));
  app.use(express.json({ limit: "64kb" }));
  app.get("/", (_req, res) => {
    res.redirect("/owner");
  });
  app.get("/owner/login", (req, res) => {
    const request = typeof req.query.request === "string" ? req.query.request : "";
    res.send(
      page(
        "Open your connector",
        `<p>Use the administrator password from your hosting account. This password is separate from SchoolSoft.</p>${form("/owner/login", "", hidden("request", request) + '<label>Administrator password <input type="password" name="password" autocomplete="current-password" required></label>', "Continue")}`,
      ),
    );
  });
  app.post("/owner/login", (req, res) => {
    if (req.get("origin") !== config.publicUrl) {
      res.status(403).end();
      return;
    }
    const result = sessions.login(req.body.password, req.ip);
    if (!result) {
      res
        .status(401)
        .send(
          page(
            "Could not sign in",
            '<p>Check your administrator password. After repeated attempts, wait a minute and try again.</p><a href="/owner/login">Try again</a>',
          ),
        );
      return;
    }
    res.cookie("__Host-owner", result.token, {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge: 30 * 60_000,
    });
    res.redirect(
      typeof req.body.request === "string" && req.body.request
        ? "/owner/consent?request=" + encodeURIComponent(req.body.request)
        : "/owner",
    );
  });
  app.use("/owner", (req, res, next) => {
    const session = sessions.get(req.headers.cookie);
    if (!session) {
      res.redirect(
        "/owner/login" +
          (typeof req.query.request === "string"
            ? "?request=" + encodeURIComponent(req.query.request)
            : ""),
      );
      return;
    }
    res.locals.csrf = session.csrf;
    if (
      req.method === "POST" &&
      (req.get("origin") !== config.publicUrl || req.body.csrf !== session.csrf)
    ) {
      res.status(403).end();
      return;
    }
    next();
  });
  app.get("/owner", async (_req, res) => {
    const status = await runtime.status();
    const csrf = res.locals.csrf as string;
    const loginMessage = status.loginError
      ? {
          expired: "The sign-in link expired. Start BankID again.",
          cancelled: "Sign-in was cancelled. Start again when ready.",
          different_guardian:
            "This connector belongs to another guardian. Sign in with its original account.",
          upstream:
            "SchoolSoft sign-in could not finish. Check your hosting settings and try again.",
        }[status.loginError]
      : "";
    res.send(
      page(
        "Your SchoolSoft connector",
        `<p>1. Sign in to SchoolSoft. 2. Add your connector to your AI app. 3. Approve the children and tools it may use.</p><p>${esc(loginMessage)}</p><p>SchoolSoft: ${status.authenticated ? "connected" : status.loginInProgress ? "waiting for BankID" : "not connected"}</p>${form("/owner/schoolsoft/login", csrf, "", "Sign in with BankID")}<p>You complete BankID yourself in SchoolSoft. Return here afterwards.</p><p>Your connector address: <code>${esc(config.publicUrl)}/mcp</code></p><p>Your hosting provider can access data processed on this server. Your AI provider receives the results you permit. The project author has no account or access.</p><h2>Connected apps</h2>${oauth
          .listGrants()
          .map(
            (g) =>
              `<p>${esc(g.clientName)}: ${esc(g.scopes.join(", "))}. Children: ${esc(g.childIds.map((id) => status.children.find((c) => c.id === id)?.name ?? "Previously selected child").join(", "))}. Expires: ${esc(new Date(g.expiresAt).toISOString().slice(0, 10))}</p>${form("/owner/revoke", csrf, hidden("grant", g.id), "Disconnect this app")}`,
          )
          .join(
            "",
          )}${form("/owner/signout", csrf, "", "Sign out of this dashboard")}<h2>Stop access</h2>${form("/owner/schoolsoft/logout", csrf, "<p>This disconnects every AI app and removes the saved SchoolSoft session.</p>", "Disconnect everything")}`,
      ),
    );
  });
  app.post("/owner/schoolsoft/login", async (_req, res) => {
    const { url } = await runtime.beginLogin();
    res.send(
      page(
        "Complete BankID",
        `<p><a href="${esc(url)}" rel="noreferrer">Open SchoolSoft and complete BankID</a></p><p>Do not share this sign-in link. After signing in, return to <a href="/owner">your connector</a>.</p>`,
      ),
    );
  });
  app.get("/schoolsoft/callback", (req, res) => {
    if (
      typeof req.query.state !== "string" ||
      typeof req.query.code !== "string" ||
      !runtime.callback(req.query.state, req.query.code)
    ) {
      res
        .status(400)
        .send(
          page("Sign-in link expired", "<p>Return to your connector and start sign-in again.</p>"),
        );
      return;
    }
    res.redirect("/owner");
  });
  app.get("/owner/consent", async (req, res) => {
    const id = typeof req.query.request === "string" ? req.query.request : "";
    const pending = oauth.pending(id);
    const status = await runtime.status();
    if (!status.authenticated) {
      res
        .status(409)
        .send(
          page(
            "Sign in to SchoolSoft first",
            '<p><a href="/owner">Open your connector</a>, sign in, then reconnect from your AI app.</p>',
          ),
        );
      return;
    }
    const children = status.children
      .map(
        (c) =>
          `<label><input type="checkbox" name="children" value="${c.id}">${esc(c.name)}</label><br>`,
      )
      .join("");
    const scopes = pending.scopes
      .map(
        (s) =>
          `<label><input type="checkbox" name="scopes" value="${esc(s)}" checked>${esc(s)}</label><br>`,
      )
      .join("");
    res.send(
      page(
        "Choose what this app may read",
        `<p>App name (provided by the app): ${esc(pending.clientName)}</p><p>Return address: ${esc(pending.redirectUri)}</p><p>Select at least one child. The selected data will be sent to your AI provider when you use these tools.</p>${form("/owner/approve", res.locals.csrf, hidden("request", id) + children + scopes, "Allow selected access")}${form("/owner/deny", res.locals.csrf, hidden("request", id), "Cancel")}`,
      ),
    );
  });
  app.post("/owner/approve", async (req, res) => {
    const values = (v: unknown): string[] =>
      Array.isArray(v)
        ? v.filter((x): x is string => typeof x === "string")
        : typeof v === "string"
          ? [v]
          : [];
    const children = values(req.body.children).map(Number);
    const status = await runtime.status();
    if (
      !status.authenticated ||
      !children.length ||
      children.some((id) => !status.children.some((c) => c.id === id))
    ) {
      res.status(400).end();
      return;
    }
    res.redirect(oauth.approve(String(req.body.request), values(req.body.scopes), children));
  });
  app.post("/owner/deny", (req, res) => {
    res.redirect(oauth.deny(String(req.body.request)));
  });
  app.post("/owner/revoke", (req, res) => {
    oauth.revokeGrant(String(req.body.grant));
    res.redirect("/owner");
  });
  app.post("/owner/signout", (req, res) => {
    sessions.logout(req.headers.cookie);
    res.clearCookie("__Host-owner", {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
    });
    res.redirect("/owner/login");
  });
  app.post("/owner/schoolsoft/logout", async (_req, res) => {
    oauth.revokeAll();
    await runtime.logout();
    sessions.clear();
    res.redirect("/owner/login");
  });
  app.use(
    mcpAuthRouter({
      provider: oauth,
      issuerUrl: new URL(config.publicUrl),
      resourceServerUrl: new URL(config.publicUrl + "/mcp"),
      scopesSupported: ["list_children", "get_schedule", "get_lunch_menu"],
    }),
  );
  app.all(
    "/mcp",
    requireBearerAuth({
      verifier: oauth,
      resourceMetadataUrl: config.publicUrl + "/.well-known/oauth-protected-resource/mcp",
    }),
    async (req, res) => {
      if (req.method !== "POST") {
        res.status(405).set("Allow", "POST").end();
        return;
      }
      if (req.get("origin") && req.get("origin") !== config.publicUrl) {
        res.status(403).end();
        return;
      }
      const cancellation = new AbortController();
      res.on("close", () => cancellation.abort());
      const auth = req.auth!;
      const grantId = String(auth.extra!.grantId);
      const server = new McpServer({ name: "schoolsoft-agent", version: "0.2.0" });
      for (const op of operations.filter((candidate) => auth.scopes.includes(candidate.name)))
        server.registerTool(
          "schoolsoft_" + op.name,
          {
            title: op.title,
            description: op.description,
            inputSchema: op.input,
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          async (args) => {
            try {
              const grant = oauth.verifyGrant(grantId);
              const data = await runtime.execute(op.name, args, grant.childIds, {
                check: () => {
                  oauth.verifyGrant(grantId);
                },
                signal: cancellation.signal,
              });
              oauth.verifyGrant(grantId);
              return { content: [{ type: "text", text: JSON.stringify(data) }] };
            } catch {
              return {
                isError: true,
                content: [
                  {
                    type: "text",
                    text: "Access is unavailable. Ask the parent to open their connector dashboard, check the SchoolSoft login and reconnect this app if needed.",
                  },
                ],
              };
            }
          },
        );
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    },
  );
  app.use((_req, res) => {
    res.status(404).send(page("Page not found", '<p><a href="/owner">Open your connector</a></p>'));
  });
  app.use((_error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res
      .status(400)
      .send(
        page(
          "Could not complete this step",
          '<p>Return to your connector and try again. If sign-in has expired, reconnect your AI app.</p><a href="/owner">Open your connector</a>',
        ),
      );
  });
  return app;
}
