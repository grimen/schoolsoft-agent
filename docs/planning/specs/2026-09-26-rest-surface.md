---
title: REST surface, generated read routes and the session endpoint
type: feature
created: 2026-09-26
status: in-review
route: dispatch
baseline_commit: c57935e
context:
  - AGENTS.md
  - docs/development/architecture.md
  - docs/planning/specs/2026-09-07-parent-hosted-connectors.md
  - docs/planning/specs/2026-09-26-typed-domain-model.md
  - https://github.com/grimen/schoolsoft-agent/issues/28
---

# REST surface: generated read routes and the session endpoint (E5.1, E5.2)

A custom UI (a family dashboard, a wall display) wants the same data an AI app gets through the parent-hosted connector, as plain JSON over HTTP. This spec adds the minimum for that: read routes generated from the operation registry and one endpoint that tells a UI whether it can show data or must send the parent to the owner dashboard. Built offline: no SchoolSoft login, no BankID round and no request to schoolsoft.se took place.

<frozen-after-approval>

## Intent

`GET /api/v1/...` on the existing connector returns the validated domain objects of the typed operations the connector already offers, for the children a grant covers, with errors a UI can branch on. It is a third adapter generated from the registry, inside the connector, behind the same OAuth grants, scopes and per-child checks as `/mcp`. It is not a reverse proxy of SchoolSoft and not GraphQL: a proxy would expose the vendor's shapes and credentials model, and a query language would need a second authorization path over a schema the registry already defines.

## Scope

In: generated GET routes for the connector's operations, `GET /api/v1/session`, problem details for every failure, a per-caller rate limit, a generated reference page, the connector guide and architecture page, an end-to-end smoke stage.

Out (later stories on #28): the reference UI page (E5.3), OpenAPI and a typed client (E5.4), response metadata such as `fetched_at` and ETags (E5.5), a composite overview (E5.6), CORS and a local serve mode (E5.7), starting a login from a UI (E5.8), change notifications (E5.9). Writes of any kind.

## Routes

| Route | Operation | Scope |
| --- | --- | --- |
| `GET /api/v1/session` | none (grant metadata) | any valid token |
| `GET /api/v1/children` | `list_children` | `list_children` |
| `GET /api/v1/children/{childId}/schedule` | `get_schedule` | `get_schedule` |
| `GET /api/v1/children/{childId}/calendar` | `get_calendar` | `get_calendar` |
| `GET /api/v1/children/{childId}/lunch-menu` | `get_lunch_menu` | `get_lunch_menu` |

**Generated, not written.** `src/http/routes.ts` maps every registry operation that `CONNECTOR_OPERATIONS` allows to a route. The slug is the operation name without `get_`/`list_`, underscores as hyphens. An operation whose input has `child_id` is child-scoped: the child comes from the path segment. One without is served below `/api/v1` directly (`list_children` becomes `/children`, which also reads naturally as the parent of the child routes). Query parameters are the operation's Zod input minus `child_id`: numbers, booleans (`true`/`false`) and strings, each at most once, unknown names refused, then validated by the operation's own schema. Building the table throws for an operation that is not read-only or has no declared `output`, and for an input type it cannot put in a query string, so a new connector operation either gets a correct route or fails the build.

**Which operations.** Exactly the typed operations the connector already offers and grants: `list_children`, `get_schedule`, `get_calendar`, `get_lunch_menu`. Consent is per operation; a REST route must never reach data the approval page did not show. `get_messages` is typed but not offered by the connector, so it gets no route; widening the connector's consent is its own decision. Never `report_absence`, `login`, `logout` or `auth_status`.

**Versioning.** `/api/v1`. A breaking change to a route or its shape is `/api/v2` alongside.

## Response

The operation's validated domain output, unchanged, as `application/json`. No envelope: metadata is E5.5 and will arrive as headers or an opt-in wrapper without breaking v1. `list_children` answers the connector's projection `{ children: [{ id, firstName }], childInFocus }`, the same as its MCP tool (only the granted children; it does not pass through `runOperation`, as before).

## Authentication and authorization

**Same tokens, same middleware.** The routes sit behind the MCP SDK's `requireBearerAuth` with the connector's own `ConnectorOAuthProvider` as verifier, exactly as `/mcp`. The token's resource indicator stays `https://<host>/mcp`: the REST surface is part of the same protected resource, so no new audience, metadata document or consent step is introduced. No cookies, no API keys, no new mechanism. A missing, invalid or expired token is the SDK's `401` with its `WWW-Authenticate: Bearer ... resource_metadata="..."` challenge.

**Who can hold a token today.** Dynamic client registration accepts only Claude's and ChatGPT's exact callback URLs (`approvedRedirect`), so until E5.3 the only tokens that reach these routes are ones issued to those clients. That is deliberate here: accepting other callbacks widens the OAuth trust boundary and belongs with the first same-origin page (E5.3, which adds the connector's own origin as a callback). The routes, errors and session endpoint do not change when it lands.

**Scopes.** A route requires the scope named after its operation (the token's scopes, which are the grant's or a narrower refresh). Missing scope: `403` `scope-not-granted`, before anything else runs.

**Children.** The child is the path's `{childId}`, never the session's ambient focus. The router passes it as `child_id` to `ConnectorRuntime.execute`, the call `/mcp` makes, with the grant's `childIds` and the same authorization callbacks (grant re-verified before every step, request cancellation). The runtime refuses a child outside the grant before it restores the session (a two-line addition that also tightens `/mcp`), and a child no longer on the account before focusing. It serializes the whole sequence (focus, cache lookup, every upstream GET, recovery), revalidates the child and its focus before each read and after a silent re-login (`validateChild`, `validateFocus`, `beforeRead`, `afterRecovery`), and checks the result's focus before releasing it. There is no second authorization path: the router checks the scope and parses input; everything about children is the runtime's.

**Revocation.** The grant is re-read on every step inside the runtime and once more after the result; a grant revoked mid-request yields `401` `oauth-token` and the data is dropped.

**Origin.** Same-origin only. A request carrying another site's `Origin` is refused with `403` (as `/mcp` does); no CORS headers are sent, so browsers block cross-origin reads anyway. An allowlist is E5.7. The connector's security headers (CSP `default-src 'none'`, `nosniff`, `no-store`, HSTS, `no-referrer`) apply unchanged.

**Rate limit.** 60 requests per minute per caller, keyed by the connector's `clientKey` (socket address or the declared proxy hop, IPv6 by /64), built by the same limiter factory as the owner routes, answering `429` problem details with `Retry-After` and `RateLimit` headers. It runs before the token check, so floods of bad tokens are bounded too.

## Errors

Every failure after the token check is `application/problem+json` (RFC 9457) with `type` (`urn:schoolsoft-agent:problem:<name>`), `title`, `status`, `detail` (the core's localized message), `hint` (the core's hint for the new `http` surface), `kind` and `retryable` (as MCP and the CLI report them), plus `ownerDashboard` for SchoolSoft-session problems and `error` (`invalid_token`, `insufficient_scope`) for token problems. `Content-Language` names the language; `Vary: Accept-Language` is set.

| Condition | Status | `type` suffix |
| --- | --- | --- |
| input error (query, path, calendar range, week) | 400 | `invalid-input` |
| token missing, invalid, expired (SDK) | 401 | SDK body |
| grant revoked while the request waited | 401 | `oauth-token` |
| scope not granted | 403 | `scope-not-granted` |
| child not in the grant, or no longer on the account | 403 | `child-not-permitted` |
| foreign `Origin` | 403 | `foreign-origin` |
| unknown route or method | 404 | `not-found` |
| `not_authenticated`: the connector's SchoolSoft session is missing, expired or rejected twice | **409** | `schoolsoft-session` |
| `not_authenticated` from the gated web login | 409 | `web-session` |
| rate limit | 429 | `rate-limited` |
| `internal` or any non-`AgentError` | 500 | `internal` (fixed text, nothing leaks) |
| `not_available`: capability not offered | 501 | `not-implemented` |
| `upstream`: `response_drift` | 502 | `response-drift` |
| `upstream`: HTTP error from the portal | 502 | `upstream` |
| connector busy, closing, or the child's focus moved mid-request | 503 + `Retry-After` | `connector-busy` |
| `not_available` otherwise, `not_configured` | 503 | `not-available` |
| `network` | 504 | `network` |

**Token bad vs SchoolSoft session gone.** This is what E5.2 exists for, so the two never share a status. `401` always means *your OAuth token*: refresh it, and if that fails connect the app again; it carries `WWW-Authenticate`. `409` always means *the connector's SchoolSoft sign-in*: the token is fine, retrying or re-running OAuth cannot help, and only the parent can fix it by signing in with BankID on the owner dashboard, whose URL is in `ownerDashboard`. `409 Conflict` fits "the request conflicts with the current state of the resource" and is already what the owner consent page answers when the connector is not signed in to SchoolSoft. `503` was rejected because clients retry it automatically; `424` because it is WebDAV-specific and poorly supported.

**Language.** The first of `sv` or `en` in `Accept-Language` by quality; otherwise the connector's default, `SCHOOLSOFT_LANG` or the locale (as the CLI decides), else English. Messages and hints come from `src/core/errors/messages.ts`; connector-specific refusals get new keys there in both languages, and every hint gains an `http` text that addresses a UI (what to tell the parent) rather than naming a CLI command or MCP tool.

## Session endpoint (E5.2)

`GET /api/v1/session`, any valid token:

```json
{
  "schoolsoft": { "signedIn": true, "loginInProgress": false, "webSession": false },
  "children": [{ "id": 201, "firstName": "Alva" }],
  "scopes": ["list_children", "get_schedule"],
  "routes": [{ "operation": "get_schedule", "method": "GET", "path": "/api/v1/children/{childId}/schedule" }],
  "ownerDashboard": "https://connector.example/owner",
  "connectionExpiresAt": "2026-10-26T12:00:00.000Z"
}
```

`signedIn` is the runtime's `status()`: a silent restore of the saved session (renewing it if needed, exactly as the owner dashboard does), never a login and never BankID. `children` are the granted children that are on the account, named like `list_children`; empty while signed out. `routes` are the ones the token's scopes allow. Nothing else: no tokens, cookies, guardian ids, history or grant ids. A UI shows data when `signedIn` is true and links to `ownerDashboard` otherwise.

## I/O and edge cases

| Input or condition | Required behaviour |
| --- | --- |
| Route table vs registry | One route per `CONNECTOR_OPERATIONS` entry, in registry order; building fails for an untyped or writing operation |
| Unknown or repeated query parameter, non-numeric number, `fresh=yes` | 400 `invalid-input`, no runtime call |
| `week=99`, bad calendar range | 400 with the operation's own localized message |
| `childId` not a positive integer | 400 |
| Token without the route's scope | 403 `scope-not-granted`, no upstream call |
| Child outside the grant | 403 `child-not-permitted`, no upstream call |
| Two children requested in parallel | Each answer is read under its own child's focus; never the other's |
| Grant revoked while queued or reading | 401 `oauth-token`; no data released |
| Portal answer drifts | 502 `response-drift`, message in the requested language, nothing cached |
| Connector signed out or session expired | 409 `schoolsoft-session` with `ownerDashboard` and the `http` login hint |
| `fresh=true` | Passed to `runOperation`, which bypasses the read cache |
| 61st request in a minute from one caller | 429 with `Retry-After` |

</frozen-after-approval>

## Code Map

- `src/http/routes.ts`: route table from the registry, query and path parsing (pure).
- `src/http/problem.ts`: problem types, error classification, language negotiation.
- `src/http/rest.ts`: the Express router (limiter, bearer, origin, session, generated routes).
- `src/http/server.ts`, `start.ts`: mount at `/api/v1`, default language.
- `src/http/runtime.ts`: `ConnectorRefusedError` with a reason (child, unavailable, child_changed) on the refusals that were plain `InputError`s, the early grant check for a named child, `webSession` in `status()`.
- `src/core/errors/messages.ts`: the `http` hint surface, connector refusal messages. `src/core/index.ts` exports `describeIssues`.
- `scripts/gen-docs.ts` → `docs/reference/rest-api.md`.
- `test/unit/http-rest-routes.test.ts`, `test/functional/http-rest.test.ts`, `test/packaging/connector-smoke/flow.mjs` (REST stage).

## Tasks & Acceptance

- [x] E5.1 Given a grant, when a UI calls the generated routes, then the four typed connector operations return their domain shapes; a grant without the scope or child is refused before any upstream call; parallel requests for two children never cross.
- [x] E5.2 Given a signed-in or signed-out connector, when a UI calls `/api/v1/session`, then it can decide between showing data and linking to the owner dashboard, and the body holds no secret.
- [ ] Live acceptance: a real browser UI on the parent's deployment against a real SchoolSoft session.

## Verification

See the pull request for the gate results.
