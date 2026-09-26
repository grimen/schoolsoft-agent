---
title: One request budget and a circuit breaker towards the portal
type: feature
created: 2026-09-26
status: in-review
route: dispatch
baseline_commit: d83aca4
context:
  - AGENTS.md
  - docs/development/architecture.md
  - docs/reference/schoolsoft-api.md
  - docs/planning/specs/2026-09-21-session-longevity.md
  - docs/planning/specs/2026-09-26-rest-surface.md
  - https://github.com/grimen/schoolsoft-agent/issues/29
---

# One request budget and a circuit breaker (E6.1, E6.2)

This project is an unofficial client of SchoolSoft's app API and web pages. Keepalive, the read cache, a connector serving several AI apps and now a REST API for custom UIs all multiply the traffic one parent causes. If SchoolSoft blocks the client or rate-limits it, the project ends for everyone. Until now nothing limited outbound requests centrally. This spec adds one budget in front of every request to the school portal and a circuit breaker that stops sending when the portal pushes back. Built offline: no SchoolSoft login, no BankID and no request to schoolsoft.se took place; SchoolSoft's real limits are unknown.

<frozen-after-approval>

## Intent

Every request this program sends to the school portal passes one limiter per process: a token bucket for the rate, a cap on requests in flight, and a pause after push-back (HTTP 429, 5xx, network failure) that honours `Retry-After`. Repeated push-back opens a breaker: requests fail at once with a message for people ("the school portal is pushing back, try again at T"), keepalive goes quiet, and after a cool-down exactly one real user request is let through to test the water. Nothing is ever retried by the budget, so a write still reaches the portal at most once.

## Outbound paths (inventory)

Every place in `src/` and `scripts/` that can reach the portal, found by grepping for `fetch`, `schoolsoftFetch`, the other request helpers of `@elias4044/ssp-node`, `goto(`, `node:http(s)` and the session object's own methods:

| Path | Where | Before | After |
| --- | --- | --- | --- |
| Eva API (profile, lunch, news, inbox, message, next event) | `portal/api/eva-api.ts` via `SchoolsoftHttp` | ssp-node `schoolsoftFetch`, injectable | budgeted |
| Webview REST (schedule, calendar, assignments, subject rooms, session) | `portal/api/webview-api.ts` via `SchoolsoftHttp` | same | budgeted |
| Legacy `/rest` (activity log, read-only POST) | `portal/api/legacy-api.ts` via `SchoolsoftHttp` | same | budgeted |
| Web-session REST (header GET, child PUT, Avstämning) and the keepalive touch | `portal/api/web-session-api.ts` via `SchoolsoftHttp` | same | budgeted; keepalive marked background |
| The one write (`POST /rest-api/parent/absence-notice`) | `portal/api/absence-api.ts` via `SchoolsoftHttp.postWrite` | same, redirects not followed | budgeted, marked `write` |
| OAuth code and refresh exchange | `auth/oauth.ts` | same | budgeted |
| Token → cookie exchange (login, restore, child switch) | `auth/session-exchange.ts` | same | budgeted |
| Guardian profile during login/restore | `auth/bankid-browser.ts` via `GuardianApi` | same | budgeted |
| **Session check after restore** (`GET /rest-api/session`) | `session.ts` → ssp-node `SchoolsoftClient.verifySession` | **ssp-node's internal fetch, not injectable, not visible to tests** | budgeted through the provider's transport; a transient failure now keeps the saved session instead of reading as "expired" |
| Headless browser page loads (contacts, bookings, files, subject menu, gated pages) | `portal/browser-portal.ts` on `PortalPage.goto` from `core/browser/playwright.ts` | Playwright navigation | one budgeted request per navigation |
| `browser verify`, `make fingerprints`, `make capture` | `core/portal/verify.ts`, `scripts/fingerprints.ts`, `providers/schoolsoft/capture/` | `PortalPage.goto` from `createBrowserSession` | budgeted (same session class) |
| Public school list | `schools.ts` (`find_school`, `configure`) | global `fetch` | budgeted (see scope below) |
| `doctor` reachability probe (`HEAD` of the portal origin) | `src/cli/commands/doctor.ts` | global `fetch` **from the CLI adapter** | moved to core (`probePortal`), URL from the provider's `webLogin.origin`, budgeted |
| Interactive web login (`login --web`) | `core/browser/web-login.ts` | headed browser the parent drives through BankID | **out of scope**: one navigation to the login page, then a human; budgeting a person's clicks would only break BankID |
| OAuth login page | the parent's own browser | not our process | out of scope |
| `browser install` | Playwright's CDN, not the portal | | out of scope |

Scope decisions. The school list is public and unauthenticated, but it is served by the same host and a blocked client is blocked there too, so it counts; `configure` has no session yet and uses a fresh budget with the default numbers. A browser page load counts as one request: the page's own sub-requests (scripts, styles, its XHR) are the portal's page doing what it does for every visitor and are not ours to schedule; the navigation is what we decide to do. A redirect followed inside ssp-node counts as the one request that caused it.

## Where the limiter sits

- **Core owns the policy** (`src/core/budget/`): `RequestBudget` is a port with one production implementation, `PortalBudget`, composed of a token-bucket/concurrency `Limiter` and a `Breaker`. Pure: clock and timers are injected, no fs, env or network. `PortalPushbackError` is in `core/errors`.
- **The provider owns the shapes**: `src/providers/schoolsoft/net.ts` is the only module that imports `schoolsoftFetch` or calls `fetch`. It exports `budgetedFetch(budget, raw?)` (the ssp-node-shaped helper every backend uses), `budgetedJson` (the public school list) and `budgetedHead` (doctor's probe), which read the status and `Retry-After` of the provider's answer shapes. The provider's entry points (`createSession`, `createAuthStrategies`, `createApiPortal`, `createSchoolDirectory`) wrap whatever fetch they are given, the injected test fake included, so tests exercise the same budget production does. The low-level functions lose their `?? schoolsoftFetch` defaults: a missing transport is a type error, not a silent bypass.
- **The port carries the budget**: `AuthDeps`, `ApiPortalContext`, `createSession` and `createSchoolDirectory` take the `RequestBudget` (required). `PlaywrightSession` takes it too (required) and wraps `goto`.
- **Wiring installs it once per session manager**: `createSessionManager` builds one `PortalBudget` (or takes `SessionDeps.budget`), and `createApiPortal`, `createPortals`, `createBrowserSession` and `createKeepalive` find it again (like the read cache), so every portal, strategy, browser session and keepalive task of a process shares it. Provider default numbers (`SchoolProvider.requestBudget`) merged with the config's overrides.
- **Nothing else can reach the portal**: `make boundaries` (and `test/boundary`) refuse a `schoolsoftFetch`/`rawRequest` import outside `net.ts`, any other request helper of `@elias4044/ssp-node`, a call to `verifySession`, a global `fetch(` anywhere in `src/` outside `net.ts`, and `node:http`/`node:https`/`undici` outside the inbound servers. A behavioural test drives every API capability, the auth flows, the browser and keepalive through the production wiring and counts that each upstream call went through the budget.

**Multi-process reality.** The budget is per process. The CLI (one process per command), a stdio MCP server per AI app and the connector (one process for all its apps and the REST API) each have their own. Two processes on one machine can together send twice the budget; that is accepted and documented rather than solved with cross-process locking, which would add a state file on the hot path for a case (a CLI command next to a running MCP server) that sends a handful of requests. The connector, the host that multiplies traffic, is one process, so its budget is the whole deployment's.

## Numbers

| Setting | Default (SchoolSoft) | Bounds | Config key | Env |
| --- | --- | --- | --- | --- |
| Sustained rate | 20 requests per minute | 1–60 | `requestsPerMinute` | `SCHOOLSOFT_REQUESTS_PER_MINUTE` |
| Burst | 10 requests | 1–20 | `requestBurst` | `SCHOOLSOFT_REQUEST_BURST` |
| In flight at once | 2 | 1–4 | `maxConcurrentRequests` | `SCHOOLSOFT_MAX_CONCURRENT_REQUESTS` |

Why: a parent's normal use is a handful of requests per minute. A cold start costs three or four (refresh, profile, cookie exchange, the read), a child switch one, a calendar two. A burst of 10 absorbs a cold start plus a multi-request operation without delay; 20 per minute is several times a busy human pace yet caps a runaway agent loop at 1,200 requests an hour per process instead of whatever the loop can do. Two in flight keeps two parallel tool calls from serialising but never lets a client fan out; the portal's own app fires more on start-up. The bounds keep a configuration from turning the budget off: at most one request a second sustained, 20 at once, 4 in parallel. Values outside the bounds are a `config_value_invalid` error, as for the other settings.

Breaker and backoff (core defaults, not configurable, so a setting cannot remove the protection):

| Rule | Value | Why |
| --- | --- | --- |
| Push-back | HTTP 429, any 5xx, a network failure (the request threw) | what a struggling or unwilling server looks like from outside; 401/403/404 are answers, not push-back |
| Pause after one push-back | `Retry-After` when given (seconds or HTTP date, clamped to 1 s–60 min), else 2 s doubling per consecutive push-back up to 60 s | honours the server; without a header, a short pause stops a tight loop without punishing a blip |
| Waiting out a pause | a request waits if the pause ends within 10 s; otherwise it fails at once with `portal_slow_down` | a short pause is invisible to the user; a long one is better said than hung on |
| Open | 3 push-backs within 2 minutes with no success in between | at a parent's pace three failures in two minutes are not noise; opening costs a few minutes of waiting, not opening could cost the project |
| Cool-down | 5 minutes, or `Retry-After` if longer (at most 60 min); doubles after a failed probe up to 60 minutes; back to 5 on close | long enough for a real incident to pass, short enough that a parent can try again the same evening |
| Half-open | after the cool-down, the first user read goes through as the probe; everything else fails fast until it answers | exactly one real request tests the water |
| Close | the probe gets an answer that is not push-back | |
| Reopen | the probe gets push-back | with the doubled cool-down |

## Behaviour

- **Queue and cancellation.** Requests queue FIFO for a token and a slot. A request whose `AbortSignal` fires while queued leaves the queue at once, consumes no token and rejects with `request_cancelled`. The connector passes each MCP/REST request's signal through `PortalDeps.signal` to the transport; an in-flight request cannot be aborted (ssp-node has no signal) and completes. When the breaker opens, everything queued fails fast and nothing of it is sent.
- **Writes.** The budget never retries. A write (`postWrite`, marked `write`) is queued and limited like a read, fails fast without being sent while the breaker is open or half-open (a write is never the probe), and a 429 answer to a write is reported as "outcome unknown, check the portal", like a 5xx, because this client cannot be sure what an unofficial endpoint did. `withSessionRecovery` and the transport's no-redirect rule are unchanged.
- **Keepalive.** Its ticks run as background requests. The scheduler asks the budget before each run and skips it (re-armed after the pause or one interval, whichever is later) while anything but "requests flow" holds; a background request that races into an open or half-open breaker fails fast and is never the probe. A skipped tick is not a failure: the task keeps its state, and it never probes. If the breaker opens overnight, keepalive stays quiet until the parent's next request closes it.
- **Read cache.** Hits make no request and are served while the breaker is open. Entries past their TTL are not served: the cache's contract ("never older than its TTL") stays, and an agent that gets stale data without knowing is worse than one told to wait. `fresh: true` while open fails fast.
- **Sessions.** `PortalPushbackError` is transient (`kind: upstream`, retryable), so a refresh or restore that meets the breaker keeps the saved session and records no loss. The session check after restore now throws transient failures instead of answering "expired".

## Errors and observability

`PortalPushbackError` (`reason`: `slow_down` or `paused`, `retryAt`) with the message keys `portal_slow_down` and `portal_paused` and the hint `portal_pushback`, in English and Swedish, for `cli`, `mcp` and `http`. The CLI exits 7 (upstream); MCP returns an error result with `kind: "upstream"`, `retryable: true`; REST answers **503** `portal-pushback` with `Retry-After` in seconds until `retryAt` and `retryAt` in the body. 503 with `Retry-After` is exactly "come back later"; clients that retry automatically are told when.

`portalHealth` (`state`: `ok`, `backing_off`, `paused`, `probing`; `retryAt` ISO or null) appears in `auth_status` (`portal`), in the connector's `status()`, on the owner dashboard (a line only when not `ok`) and in `GET /api/v1/session` as `schoolsoft.portal`. `doctor` shows the configured numbers and this process's state (a CLI process starts fresh; the long-lived server's state is in `auth_status`). While the portal is `paused`, `signedIn: false` from `/api/v1/session` does not mean BankID is needed: a UI shows "try again at `retryAt`" instead of the owner-dashboard link.

## I/O and edge cases

| Input or condition | Required behaviour |
| --- | --- |
| N requests over T from any mix of callers (two children, keepalive and user) | never more than burst + rate × T started, never more than the cap in flight |
| 429 with `Retry-After: 30` | that request fails with `portal_slow_down`; nothing else is sent for 30 s; a request arriving within the last 10 s of it waits |
| 429 without `Retry-After`, 5xx | pause 2 s, 4 s, …; the 5xx itself is still the transport's `upstream` error |
| Third push-back within 2 minutes | breaker open 5 min; queued requests fail fast unsent |
| Request while open | `portal_paused`, nothing sent |
| After cool-down | first user read is sent; concurrent ones and writes fail fast |
| Probe answered | closed, cool-down back to 5 min |
| Probe pushed back | open again for 10 min (then 20, 40, 60) |
| Keepalive tick while not closed | no request; re-armed later |
| Write while open | `portal_paused`, not sent |
| Write answered 429 | `write_outcome_unknown`, not repeated |
| Cancelled while queued | leaves the queue, no token spent, `request_cancelled` |
| Setting out of bounds | `config_value_invalid` in English and Swedish |

</frozen-after-approval>

## Code Map

- `src/core/budget/`: `limiter.ts` (token bucket, slots, FIFO queue, cancellation), `breaker.ts` (push-back window, pause, open/half-open/closed), `budget.ts` (`RequestBudget` port, `PortalBudget`, `portalHealth`), `retry-after.ts`, `policy.ts` (breaker defaults, bounds).
- `src/core/errors/`: `PortalPushbackError`, `request_cancelled`, `portal_slow_down`, `portal_paused`, hint `portal_pushback`.
- `src/core/config.ts`: the three settings with bounds.
- `src/core/provider/types.ts`: `requestBudget` defaults; the budget on `AuthDeps`, `ApiPortalContext`, `createSession`, `createSchoolDirectory`.
- `src/core/wiring.ts`: one budget per manager, background marking for keepalive, `requestBudgetOf`, `createRequestBudget`, `probePortal`; `PortalDeps.signal`.
- `src/core/browser/playwright.ts`: `goto` through the budget.
- `src/core/keepalive/scheduler.ts`: `pausedUntil` gate.
- `src/providers/schoolsoft/net.ts`: the one transport; the provider's entry points wrap with it; `session.ts` verifies through it.
- `src/http/`: `status().portal`, owner dashboard line, `/api/v1/session` `schoolsoft.portal`, problem `portal-pushback` (503 + `Retry-After`), signals passed to the portal.
- `scripts/check-boundaries.ts`: the outbound rules.
- Tests: `test/unit/request-budget.test.ts` (limiter, breaker, messages), `test/unit/request-budget-wiring.test.ts` (production wiring with the simulator), `test/unit/net.test.ts`, `test/boundary/outbound.test.ts`, `test/functional/request-budget-surfaces.test.ts` (CLI, MCP), the REST case in `test/functional/http-rest.test.ts`, the browser case in `test/unit/browser-session.test.ts`. `test/helpers/offline.ts` is preloaded into the offline suites and fails any request to the real portal.

## Tasks & Acceptance

- [x] E6.1 Given the production wiring with fake fetch and clock, when keepalive and user requests for two children run together, then no window ever sees more than the budget, the concurrency cap holds, 429 and 5xx pause the gate and `Retry-After` is honoured, and every upstream call passed the budget.
- [x] E6.2 Given three push-backs, when the next request comes, then it fails fast on every surface in both languages (CLI exit 7, MCP error result, REST 503 + `Retry-After`); keepalive sends nothing; after the cool-down exactly one user read is sent, which closes or reopens the breaker; writes are never retried and never sent while open.
- [ ] Live: SchoolSoft's real limits and how it signals them (429? 503? a login page?) are unknown. The first live weeks should read `auth_status.portal` and the connector's dashboard for any push-back, and the numbers above should be revisited with what they show.

## Verification

See the pull request for the gate results.
