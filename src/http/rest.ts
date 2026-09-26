/* oxlint-disable oxc/no-async-endpoint-handlers -- every handler catches its own failures and answers with problem+json; http-rest.test.ts covers them. */
/**
 * The REST surface for custom UIs: read routes generated from the operation registry
 * (routes.ts) plus the session endpoint. Same OAuth tokens, scopes and per-child grant
 * as /mcp, and the same runtime call, so consent, child focus, the read cache, output
 * validation, recovery and revocation checks are the ones /mcp relies on.
 */
import { Router, type Request, type Response } from "express";
import { rateLimit, type Options as RateLimitOptions } from "express-rate-limit";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import type { OAuthTokenVerifier } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import { PortalPushbackError, type Lang } from "../core/index.js";
import type { ConnectorGrant } from "./oauth.js";
import type { ConnectorRuntime } from "./runtime.js";
import {
  classify,
  negotiateLang,
  problemBody,
  refusals,
  retryAfterSeconds,
  type Classified,
} from "./problem.js";
import { parseChildId, parseQuery, restRoutes } from "./routes.js";
import { SessionSchema } from "./api-schemas.js";
import { OVERVIEW_QUERY, OVERVIEW_SCOPES, OVERVIEW_SLUG, buildOverview } from "./overview.js";

/** Requests per minute per caller (clientKey) across the whole REST surface. */
export const REST_REQUESTS_PER_MINUTE = 60;

export interface RestOptions {
  publicUrl: string;
  oauth: OAuthTokenVerifier & { verifyGrant(id: string): ConnectorGrant };
  runtime: Pick<ConnectorRuntime, "execute" | "executeForChild" | "status">;
  /** Language when the caller's Accept-Language names neither Swedish nor English. */
  lang: Lang;
  /** The connector's per-caller keying (server.ts), so REST limits callers as the owner routes do. */
  perCaller: Partial<RateLimitOptions>;
  /** Clock for Retry-After (tests). */
  now?: () => number;
}

export function restApi({
  publicUrl,
  oauth,
  runtime,
  lang,
  perCaller,
  now = Date.now,
}: RestOptions): Router {
  const resourceMetadataUrl = publicUrl + "/.well-known/oauth-protected-resource/mcp";
  const routes = restRoutes();
  const send = (req: Request, res: Response, problem: Classified) => {
    const chosen = negotiateLang(req.get("accept-language"), lang);
    const body = problemBody(problem, chosen, publicUrl);
    if (problem.name === "oauth-token")
      res.set(
        "WWW-Authenticate",
        `Bearer error="invalid_token", error_description="${body.title}", resource_metadata="${resourceMetadataUrl}"`,
      );
    if (problem.name === "scope-not-granted")
      res.set(
        "WWW-Authenticate",
        `Bearer error="insufficient_scope", scope="${problem.error.params.operation}", resource_metadata="${resourceMetadataUrl}"`,
      );
    if (problem.name === "connector-busy") res.set("Retry-After", "1");
    if (problem.error instanceof PortalPushbackError)
      res.set("Retry-After", retryAfterSeconds(problem.error.retryAt, now()));
    res
      .status(body.status)
      .set({ "Content-Language": chosen, Vary: "Accept-Language" })
      .type("application/problem+json")
      .send(JSON.stringify(body));
  };
  /** The grant id behind the bearer token; each step re-verifies it, so revocation is immediate. */
  const grantOf = (req: Request) => String(req.auth!.extra!.grantId);

  const router = Router();
  router.use(
    rateLimit({
      windowMs: 60_000,
      limit: REST_REQUESTS_PER_MINUTE,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      ...perCaller,
      handler: (req, res) => send(req, res, refusals.rateLimited()),
    }),
  );
  router.use(requireBearerAuth({ verifier: oauth, resourceMetadataUrl }));
  router.use((req, res, next) => {
    if (req.get("origin") && req.get("origin") !== publicUrl) send(req, res, refusals.origin());
    else next();
  });

  router.get("/session", async (req, res) => {
    try {
      const grantId = grantOf(req);
      const grant = oauth.verifyGrant(grantId);
      const status = await runtime.status();
      oauth.verifyGrant(grantId);
      const scopes = req.auth!.scopes;
      res.json(
        SessionSchema.parse({
          schoolsoft: {
            signedIn: status.authenticated,
            loginInProgress: status.loginInProgress,
            webSession: status.webSession === true,
            // Not "ok": the portal is pushing back; show "try again at retryAt", not the dashboard link.
            portal: status.portal,
          },
          children: status.children
            .filter((child) => grant.childIds.includes(child.id))
            .map((child) => ({ id: child.id, firstName: child.name })),
          scopes,
          routes: routes
            .filter((route) => scopes.includes(route.operation.name))
            .map((route) => ({ operation: route.operation.name, method: "GET", path: route.path })),
          ownerDashboard: publicUrl + "/owner",
          connectionExpiresAt: new Date(grant.expiresAt).toISOString(),
        }),
      );
    } catch (error) {
      send(req, res, classify(error));
    }
  });

  // The composite overview: one child's first paint in one request (E5.6).
  router.get(`/children/:childId/${OVERVIEW_SLUG}`, async (req, res) => {
    const cancellation = new AbortController();
    res.on("close", () => cancellation.abort());
    try {
      const scopes = req.auth!.scopes;
      if (!OVERVIEW_SCOPES.some((scope) => scopes.includes(scope))) {
        send(req, res, refusals.scope(OVERVIEW_SCOPES.join(" ")));
        return;
      }
      const input = parseQuery(OVERVIEW_QUERY, req.query);
      const childId = parseChildId(String(req.params.childId));
      const grantId = grantOf(req);
      const grant = oauth.verifyGrant(grantId);
      const chosen = negotiateLang(req.get("accept-language"), lang);
      const overview = await buildOverview({
        childId,
        input,
        scopes,
        now: now(),
        read: (reads, keep) =>
          runtime.executeForChild(
            childId,
            reads,
            grant.childIds,
            {
              check: () => {
                oauth.verifyGrant(grantId);
              },
              signal: cancellation.signal,
            },
            keep,
          ),
        problem: (problem) => problemBody(problem, chosen, publicUrl),
      });
      oauth.verifyGrant(grantId);
      res.set({ "Content-Language": chosen, Vary: "Accept-Language" }).json(overview);
    } catch (error) {
      send(req, res, classify(error));
    }
  });

  for (const route of routes) {
    const name = route.operation.name;
    router.get(route.pattern, async (req, res) => {
      const cancellation = new AbortController();
      res.on("close", () => cancellation.abort());
      try {
        if (!req.auth!.scopes.includes(name)) {
          send(req, res, refusals.scope(name));
          return;
        }
        const args = parseQuery(route, req.query);
        if (route.childScoped) args.child_id = parseChildId(String(req.params.childId));
        const grantId = grantOf(req);
        const grant = oauth.verifyGrant(grantId);
        const data = await runtime.execute(name, args, grant.childIds, {
          check: () => {
            oauth.verifyGrant(grantId);
          },
          signal: cancellation.signal,
        });
        oauth.verifyGrant(grantId);
        res.json(data);
      } catch (error) {
        send(req, res, classify(error));
      }
    });
  }
  router.use((req, res) => send(req, res, refusals.notFound()));
  return router;
}
