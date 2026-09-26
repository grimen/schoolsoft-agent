/* oxlint-disable oxc/no-async-endpoint-handlers -- Express 5 forwards rejected promises; host-probe-http.test.ts covers the error page. */
/**
 * The probe over HTTP: the connector's OAuth provider, owner sign-in and hardening in
 * front of a stateful MCP endpoint (elicitation needs the answer to reach the same
 * session) whose tools are the probe's. Fake data only; no school portal, no runtime.
 */
import { randomBytes, randomUUID } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { rateLimit, type Options as RateLimitOptions } from "express-rate-limit";
import { OAuthError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ConnectorOAuthProvider, type OAuthState } from "../oauth.js";
import { OwnerSessions } from "../owner-session.js";
import { clientKey } from "../client-key.js";
import { escapeHtml as esc, form, hidden, page } from "../pages.js";
import type { ProbeLog } from "./log.js";
import { ProbeConfirmations } from "./confirmations.js";
import {
  PROBE_SCOPES,
  PROBE_SERVER_NAME,
  PROBE_TOOLS,
  UrlPages,
  advertiseSecuritySchemes,
  createProbeServer,
  tapMessages,
} from "./tools.js";
import { harden, logRequests, mountUrlPages, sameToken } from "./web.js";

export interface ProbeAppOptions {
  publicUrl: string;
  proxyHops: number;
  adminPassword: string;
  log: ProbeLog;
  now?: () => number;
  /** Open MCP sessions kept at most; the least recently used one is closed first. */
  maxSessions?: number;
  /** An MCP session unused this long is closed. */
  sessionIdleMs?: number;
  elicitTimeoutMs?: number;
}
interface McpSession {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  clientId: string;
  grantId: string;
  tag: string;
  lastUsed: number;
}
/** Scopes in `scopes_supported`; `probe_step_up_hidden` is accepted but never advertised. */
export const ADVERTISED_SCOPES = [PROBE_SCOPES.read, PROBE_SCOPES.stepUp, PROBE_SCOPES.stepUpMeta];
/** The one child a probe grant is for; never a real child id. */
const PROBE_CHILD = 1;
const NEXT_PAGE = /^\/probe\/elicit\/[A-Za-z0-9_-]{43}$/;

/** A requested scope string for the log: at most 10 names of at most 40 characters. */
function words(value: string): string[] {
  return value
    .split(" ")
    .filter(Boolean)
    .slice(0, 10)
    .map((word) => word.slice(0, 40));
}

export function createProbeApp(options: ProbeAppOptions) {
  const { publicUrl, log } = options;
  const now = options.now ?? Date.now;
  const maxSessions = options.maxSessions ?? 32;
  const idleMs = options.sessionIdleMs ?? 30 * 60_000;
  const resourceMetadataUrl = publicUrl + "/.well-known/oauth-protected-resource/mcp";
  let state: OAuthState | undefined;
  // In memory on purpose: restarting the probe forgets every grant.
  const oauth = new ConnectorOAuthProvider({
    resourceUrl: publicUrl + "/mcp",
    scopes: Object.values(PROBE_SCOPES),
    repository: {
      read: () => state,
      write: (value) => {
        state = value;
      },
    },
    now,
  });
  const owners = new OwnerSessions(options.adminPassword, now);
  const confirmations = new ProbeConfirmations({ now });
  const pages = new UrlPages(async () => publicUrl, { now });
  const sessions = new Map<string, McpSession>();

  const app = express();
  app.set("trust proxy", options.proxyHops);
  harden(app, () => publicUrl);
  logRequests(app, log);
  app.use(express.urlencoded({ extended: false, limit: "16kb" }));
  app.use(express.json({ limit: "64kb" }));
  app.get("/", (_req, res) => {
    res.redirect("/owner");
  });

  const perCaller: Partial<RateLimitOptions> = {
    keyGenerator: (req) => clientKey(req.ip),
    validate: { xForwardedForHeader: false, keyGeneratorIpFallback: false },
  };
  const ownerLoginLimit = rateLimit({
    windowMs: 60_000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    ...perCaller,
    skip: (req) => owners.matches(req.body?.password),
  });

  const loginPage = (hiddenFields: string) =>
    page(
      "Open the host probe",
      `<p>This is the schoolsoft-agent host probe, not your SchoolSoft connector. It has no school data. Use the probe's own password.</p>${form("/owner/login", "", hiddenFields + '<label>Probe password <input type="password" name="password" autocomplete="current-password" required></label>', "Continue")}`,
    );
  const loginPageLimit = rateLimit({
    windowMs: 60_000,
    limit: 60,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    ...perCaller,
  });
  app.get("/owner/login", loginPageLimit, (req, res) => {
    const request = typeof req.query.request === "string" ? req.query.request : "";
    const next = typeof req.query.next === "string" ? req.query.next : "";
    res.send(loginPage(hidden("request", request) + hidden("next", next)));
  });
  app.post("/owner/login", ownerLoginLimit, (req, res) => {
    if (req.get("origin") !== publicUrl) {
      res.status(403).end();
      return;
    }
    const result = owners.login(req.body?.password);
    if (!result) {
      res
        .status(401)
        .send(
          page(
            "Could not sign in",
            '<p>Check the probe password.</p><a href="/owner/login">Try again</a>',
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
    const next = typeof req.body.next === "string" ? req.body.next : "";
    res.redirect(
      typeof req.body.request === "string" && req.body.request
        ? "/owner/consent?request=" + encodeURIComponent(req.body.request)
        : NEXT_PAGE.test(next)
          ? next
          : "/owner",
    );
  });
  const ownerGate = (req: Request, res: Response, next: NextFunction) => {
    const session = owners.get(req.headers.cookie);
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
      (req.get("origin") !== publicUrl || !sameToken(req.body?.csrf, session.csrf))
    ) {
      res.status(403).end();
      return;
    }
    next();
  };
  // The URL-elicitation page is the #59 owner channel: it needs the owner's sign-in.
  // Whether the SameSite=Strict cookie arrived when the host opened the link is itself
  // an answer, so it is recorded before the sign-in redirect.
  app.use("/probe/elicit/:id", (req, res, next) => {
    const signedIn = owners.get(req.headers.cookie) !== undefined;
    if (req.method === "GET")
      log.record({
        event: "url_page",
        stage: signedIn ? "signed_in" : "sign_in_required",
        ownerCookie: /(^|;\s*)__Host-owner=/.test(req.headers.cookie ?? ""),
      });
    if (!signedIn) {
      if (req.method !== "GET") {
        res.status(403).end();
        return;
      }
      res.redirect("/owner/login?next=" + encodeURIComponent(req.originalUrl.split("?")[0]));
      return;
    }
    ownerGate(req, res, next);
  });
  mountUrlPages(app, { pages, log, origin: () => publicUrl });
  app.use("/owner", ownerGate);

  /** The latest 30 events, newest first. */
  const recent = () =>
    log
      .recent()
      .slice(-30)
      .reduce((html, entry) => {
        const { at, surface: _surface, event, ...fields } = entry;
        return `<li><code>${esc(at.slice(11, 19))} ${esc(event)} ${esc(JSON.stringify(fields))}</code></li>${html}`;
      }, "");
  app.get("/owner", (_req, res) => {
    const csrf = res.locals.csrf as string;
    const grants = oauth
      .listGrants()
      .map(
        (grant) =>
          `<p>${esc(grant.clientName)}: ${esc(grant.scopes.join(", "))}</p>${form("/owner/revoke", csrf, hidden("grant", grant.id), "Disconnect this app")}`,
      )
      .join("");
    res.send(
      page(
        "Host probe",
        `<p>This is ${esc(PROBE_SERVER_NAME)}: fake tools that answer how an AI app handles write-style tools. It never contacts SchoolSoft.</p><p>Probe address for your AI app: <code>${esc(publicUrl)}/mcp</code></p><h2>Connected apps</h2>${grants || "<p>None yet.</p>"}${form("/owner/revoke-all", csrf, "", "Disconnect every app")}<h2>What the probe saw (latest first)</h2><ul>${recent()}</ul>${form("/owner/signout", csrf, "", "Sign out")}`,
      ),
    );
  });
  app.get("/owner/consent", (req, res) => {
    const id = typeof req.query.request === "string" ? req.query.request : "";
    const pending = oauth.pending(id);
    const scopes = pending.scopes
      .map(
        (scope) =>
          `<label><input type="checkbox" name="scopes" value="${esc(scope)}"${scope === PROBE_SCOPES.read ? " checked" : ""}>${esc(scope)}${ADVERTISED_SCOPES.includes(scope as never) ? "" : " (not advertised)"}</label><br>`,
      )
      .join("");
    res.send(
      page(
        "Choose what this app may use",
        `<p>App name (provided by the app): ${esc(pending.clientName)}</p><p>Return address: ${esc(pending.redirectUri)}</p><p>Requested by the app: <code>${esc(pending.scopes.join(" "))}</code></p><p>Only probe_read is ticked, as write scopes will be. Leave the step-up scopes unticked to test whether the app asks again later.</p>${form("/owner/approve", res.locals.csrf, hidden("request", id) + scopes, "Allow selected access")}${form("/owner/deny", res.locals.csrf, hidden("request", id), "Cancel")}`,
      ),
    );
  });
  /** A form field given once, several times or not at all, as strings. */
  const values = (value: unknown): string[] =>
    [value].flat().filter((entry): entry is string => typeof entry === "string");
  app.post("/owner/approve", (req, res) => {
    const scopes = values(req.body.scopes);
    const target = oauth.approve(String(req.body.request), scopes, [PROBE_CHILD]);
    log.record({ event: "oauth", step: "consent", approvedScopes: scopes });
    res.redirect(target);
  });
  app.post("/owner/deny", (req, res) => {
    log.record({ event: "oauth", step: "deny" });
    res.redirect(oauth.deny(String(req.body.request)));
  });
  const closeSessions = (keep: (session: McpSession) => boolean, why: string) => {
    for (const [id, session] of sessions)
      if (!keep(session)) {
        sessions.delete(id);
        log.record({ event: "session", session: session.tag, step: why });
        void session.transport.close();
        void session.server.close();
      }
  };
  app.post("/owner/revoke", (req, res) => {
    const grant = String(req.body.grant);
    oauth.revokeGrant(grant);
    closeSessions((session) => session.grantId !== grant, "revoked");
    res.redirect("/owner");
  });
  app.post("/owner/revoke-all", (_req, res) => {
    oauth.revokeAll();
    closeSessions(() => false, "revoked");
    res.redirect("/owner");
  });
  app.post("/owner/signout", (req, res) => {
    owners.logout(req.headers.cookie);
    res.clearCookie("__Host-owner", {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
    });
    res.redirect("/owner/login");
  });

  // What the host asks the authorization server for: scope names, grant types and
  // callback hosts, before the SDK's router answers.
  app.use(["/register", "/authorize", "/token", "/revoke"], (req, res, next) => {
    const input = { ...(req.query as Record<string, unknown>), ...(req.body as object) } as Record<
      string,
      unknown
    >;
    const step = req.baseUrl.slice(1);
    res.on("finish", () => {
      const fields: Record<string, string | number | string[] | null> = { status: res.statusCode };
      if (step === "register") {
        fields.clientName = String(input.client_name ?? "").slice(0, 60);
        fields.callbackHosts = [
          ...new Set(
            values(input.redirect_uris).map((uri) => {
              try {
                return new URL(uri).host;
              } catch {
                return "invalid";
              }
            }),
          ),
        ].slice(0, 5);
      }
      if (step === "authorize" || step === "token")
        fields.requestedScopes = typeof input.scope === "string" ? words(input.scope) : null;
      if (step === "token") fields.grantType = String(input.grant_type ?? "").slice(0, 40);
      log.record({ event: "oauth", step, ...fields });
    });
    next();
  });
  app.use(
    mcpAuthRouter({
      provider: oauth,
      issuerUrl: new URL(publicUrl),
      resourceServerUrl: new URL(publicUrl + "/mcp"),
      scopesSupported: ADVERTISED_SCOPES,
      resourceName: PROBE_SERVER_NAME,
      authorizationOptions: { rateLimit: perCaller },
      tokenOptions: { rateLimit: perCaller },
      clientRegistrationOptions: { rateLimit: perCaller },
      revocationOptions: { rateLimit: perCaller },
    }),
  );

  const jsonRpcError = (res: Response, status: number, code: number, message: string) =>
    res.status(status).json({ jsonrpc: "2.0", error: { code, message }, id: null });
  app.all(
    "/mcp",
    requireBearerAuth({
      verifier: oauth,
      requiredScopes: [PROBE_SCOPES.read],
      resourceMetadataUrl,
    }),
    async (req, res) => {
      if (req.get("origin") && req.get("origin") !== publicUrl) {
        res.status(403).end();
        return;
      }
      const auth = req.auth!;
      const grantId = String(auth.extra!.grantId);
      closeSessions((session) => now() - session.lastUsed < idleMs, "idle");
      if (req.method === "POST") {
        const messages: unknown[] = Array.isArray(req.body) ? req.body : [req.body];
        for (const message of messages) {
          const call = message as { method?: unknown; params?: { name?: unknown } } | null;
          const tool = PROBE_TOOLS.find(
            (candidate) =>
              call?.method === "tools/call" &&
              candidate.name === call.params?.name &&
              candidate.challenge === "http_403",
          );
          if (tool && !auth.scopes.includes(tool.scope!)) {
            // The MCP step-up challenge: every scope the call needs, the granted ones included.
            const needed = [...new Set([...auth.scopes, tool.scope!])].join(" ");
            log.record({
              event: "step_up",
              tool: tool.name,
              outcome: "challenged_http_403",
              granted: [...auth.scopes],
            });
            res
              .status(403)
              .set(
                "WWW-Authenticate",
                `Bearer error="insufficient_scope", scope="${needed}", resource_metadata="${resourceMetadataUrl}", error_description="The probe needs the ${tool.scope} permission"`,
              )
              .json({
                error: "insufficient_scope",
                error_description: `The probe needs the ${tool.scope} permission`,
              });
            return;
          }
        }
      }
      const sessionId = req.get("mcp-session-id");
      if (sessionId !== undefined) {
        const session = sessions.get(sessionId);
        if (!session || session.clientId !== auth.clientId) {
          jsonRpcError(res, 404, -32001, "Session not found");
          return;
        }
        if (session.grantId !== grantId) {
          // A new grant for the same app (after a step-up): the session carries on.
          session.grantId = grantId;
          log.record({ event: "session", session: session.tag, step: "rebound_to_new_grant" });
        }
        session.lastUsed = now();
        await session.transport.handleRequest(req, res, req.body);
        return;
      }
      const initialize =
        req.method === "POST" &&
        !Array.isArray(req.body) &&
        (req.body as { method?: unknown } | undefined)?.method === "initialize";
      if (!initialize) {
        jsonRpcError(res, 400, -32000, "Bad Request: No valid session ID provided");
        return;
      }
      if (sessions.size >= maxSessions) {
        const oldest = [...sessions.values()].sort((a, b) => a.lastUsed - b.lastUsed)[0];
        closeSessions((session) => session !== oldest, "evicted");
      }
      const tag = randomBytes(4).toString("hex");
      const server = createProbeServer({
        surface: "http",
        log,
        session: tag,
        confirmations,
        pages,
        now,
        elicitTimeoutMs: options.elicitTimeoutMs,
        resourceMetadataUrl,
      });
      const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, {
            transport,
            server,
            clientId: auth.clientId,
            grantId,
            tag,
            lastUsed: now(),
          });
          log.record({ event: "session", session: tag, step: "opened" });
        },
        onsessionclosed: (id) => {
          sessions.delete(id);
          log.record({ event: "session", session: tag, step: "closed_by_host" });
        },
      });
      await server.connect(transport);
      tapMessages(transport, log, tag);
      advertiseSecuritySchemes(transport);
      await transport.handleRequest(req, res, req.body);
    },
  );
  app.use((_req, res) => {
    res.status(404).send(page("Page not found", '<p><a href="/owner">Open the probe</a></p>'));
  });
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = (error as { status?: unknown } | null)?.status;
    // An OAuth protocol error or a body the parsers refused (they carry a 4xx status).
    const callerFault =
      error instanceof OAuthError || (typeof status === "number" && status >= 400 && status < 500);
    res
      .status(callerFault ? 400 : 500)
      .send(
        page(
          callerFault ? "Could not complete this step" : "The probe had a problem",
          '<p>Return to the probe and try again.</p><a href="/owner">Open the probe</a>',
        ),
      );
  });
  return {
    app,
    sessions: () => sessions.size,
    close: async () => closeSessions(() => false, "shutdown"),
  };
}
