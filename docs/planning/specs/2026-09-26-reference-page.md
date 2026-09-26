---
title: Reference page, one week for one child over the public REST surface
type: feature
created: 2026-09-26
status: in-review
route: dispatch
baseline_commit: 7085696
context:
  - AGENTS.md
  - docs/development/architecture.md
  - docs/planning/specs/2026-09-07-parent-hosted-connectors.md
  - docs/planning/specs/2026-09-26-rest-surface.md
  - docs/planning/specs/2026-09-26-typed-domain-model.md
  - https://github.com/grimen/schoolsoft-agent/issues/28
---

# Reference page: one week for one child over the public REST surface (E5.3)

E5.1 and E5.2 gave custom UIs read routes and a session endpoint. Nothing has used them from a browser yet. This story adds the smallest page that does: the connector serves one static page that signs in the way any third-party UI would, then shows one child's week. It is a proof, not a product. The app (E11.4 onward) replaces it, and E11.10 serves that app at `/app`. Built offline: no SchoolSoft login, no BankID round and no request to schoolsoft.se took place.

<frozen-after-approval>

## Intent

A parent opens `https://<connector>/reference/`, connects the page once through the ordinary OAuth consent, and sees the current week's lessons, lunch and school events for one of the children the grant covers. The page uses only what a third-party UI can use: OAuth discovery, dynamic client registration, the authorization code flow with PKCE, the token and revocation endpoints, `GET /api/v1/session` and the generated routes. It has no private route, cookie or header. Anything the page needs and the surface lacks is recorded as a finding (below), not worked around.

## Scope

In: the page at `/reference/`, the connector's own page accepted as an OAuth callback, a scoped security policy for that one path, a link from the owner dashboard, consent wording for this return address, tests, the connector guide and the REST reference.

Out: anything a product UI needs (E11): styling beyond legibility, translations, offline use, long-lived sign-in, a child picker that remembers its choice, messages, absence. Changing any REST route or its shape. CORS (E5.7).

## Authentication

**Why OAuth and not the owner cookie.** The owner cookie (`__Host-owner`) is the administrator's session. It can approve grants, revoke them and sign out of SchoolSoft, and it carries no scopes or children. If the page read data with it, that would be a second way to read data that bypasses the consent page's scope and child choice. That is the private backdoor this story must not add. So the page is an OAuth client like Claude or ChatGPT, and the owner approves it on the same consent page.

**Callback.** Registration and authorization accept exactly one more redirect URI: `<publicUrl>/reference/`, the connector's own origin with this path, nothing else on that origin. This is the widening the E5.1 spec deferred to this story. The vendor allowlist (`approvedRedirect`) is unchanged; the extra callback is passed to `ConnectorOAuthProvider` by the composition root, so the provider holds no knowledge of pages. Anyone can register a client with this callback. That gains them nothing, because the code is delivered to the parent's own browser on the connector's own page, and PKCE ties it to the verifier held by the tab that started the flow.

**Flow.**

1. Discovery: `GET /api/v1/session` without a token answers `401` with `WWW-Authenticate: Bearer resource_metadata="…"`. The page reads that URL (same origin only), then the authorization server metadata it names. From them it takes the resource indicator and the registration, authorization, token and revocation endpoints. Nothing is hard-coded except the session path.
2. Registration: `POST /register` as a public client (`token_endpoint_auth_method: none`), `client_name: "Reference page"`, the callback above.
3. Authorization: a full-page navigation to `/authorize` with PKCE (S256, a 32-byte verifier), a 32-byte `state`, the resource indicator and the scopes `get_schedule get_lunch_menu get_calendar`. The owner signs in if needed, picks the children and may untick scopes on the existing consent page. That page names the return address. For this callback it says the data is shown in this browser, not sent to an AI provider.
4. Callback: the page removes `code`, `state` and `error` from the address bar (`history.replaceState`) before anything else. It refuses a `state` it did not issue in this tab. Then it exchanges the code at `/token`.
5. Reads: `Authorization: Bearer` on every `/api/v1` call. On `401` it refreshes once with the refresh token. If the refresh fails, it forgets the tokens and shows the connect step again.
6. Disconnect: `POST /revoke` with the refresh token, which withdraws the whole grant (as for any client), then forgets everything.

**Where tokens live.** The access token is kept in memory only. The client id, the refresh token and, during the redirect, the PKCE verifier and `state` are kept in `sessionStorage`. That storage belongs to this tab and origin and is gone when the tab closes. A reload refreshes instead of asking for consent again. This follows E11.5's "in memory plus refresh" for the web. Nothing is written to `localStorage` or to cookies.

## The page

**Serving.** `GET /reference/` answers one HTML document with the script and the styles inline. `GET /reference` redirects there (301), so the callback URI stays canonical. Any other method or sub-path gets the connector's usual 404. The page is public: it holds no data and no secret, and without a token it shows only a "Connect" button. Every data read is authorized by the REST surface.

**Headers.** For `/reference/` only, the security policy becomes `default-src 'none'; script-src 'sha256-<script>'; style-src 'sha256-<styles>'; connect-src 'self'; img-src 'none'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'`. The hashes cover the exact inline text, so no other script runs and nothing can be framed or posted. Every other connector header is unchanged: `no-store`, `nosniff`, `no-referrer` (the callback's code never leaves in a `Referer`), HSTS, host pinning. The owner routes and the API keep their strict policy.

**What it renders.** After `GET /api/v1/session`:

| Session says | Page shows |
| --- | --- |
| `signedIn: false`, `loginInProgress` either way | "The connector is not signed in to SchoolSoft", with a link to `ownerDashboard` |
| `portal.state` not `ok` | "SchoolSoft is pushing back; try again after `retryAt`", no dashboard link |
| no children | "This connection covers no children"; reconnect to choose one |
| otherwise | the week for the selected child (the first by default, a selector when there are more) |

For the selected child and the shown week, the page reads each route that `session.routes` lists, in parallel:

- `GET …/children/{id}/schedule?week=W`: lessons per day (time, title, room, teacher).
- `GET …/children/{id}/lunch-menu?week=W`: the dishes per day.
- `GET …/children/{id}/calendar?start_date=Mon&end_date=Sun`: school events only (`kind: "event"`). The calendar's lessons repeat the schedule and are left out.

A route missing from `session.routes` (the owner unticked the scope) shows "not granted" in its place. A problem answer shows its `title`, `detail` and `hint`. A `409` also links to the owner dashboard. Previous and next buttons move one week. The current week is computed in Europe/Stockholm.

The days shown are Monday to Friday of the week, plus a weekend day only when it has an entry. Times come from the ISO strings as sent (they carry Stockholm's offset); the page does no timezone arithmetic of its own.

**One child, always.** Each section is kept only when its body's `child.id` equals the child the page asked for. An answer for any other child is dropped with a notice, never rendered. The server already guarantees this (E5.1). The page checks again so that a fault on either side cannot put one child's data under another child's name. Switching child discards the other child's sections before the new reads start.

**Output safety.** Every value from the API is HTML-escaped. The only URL taken from a response (`ownerDashboard`) becomes a link only when it is on the page's own origin.

## Code

The page's logic is one browser module, `src/http/reference/app.ts`. It has no value imports (only `import type` from core's domain types) and runs in the browser, never in the connector. Its browser dependencies (`fetch`, `sessionStorage`, `location`, `history`, `crypto`, the root element, the clock) are injected, so the offline suite drives it with fakes to 100% coverage. `src/http/reference/page.ts` builds the HTML, the hashes and the policy, and mounts the routes. The connector inlines the module's JavaScript. The built connector reads the file `tsc` emitted next to `page.js`. Running from source (tests, `npm run dev`) strips the types from `app.ts` with Node's `stripTypeScriptTypes`. Either way the served text is exactly the text that was hashed.

## I/O and edge cases

| Input or condition | Required behaviour |
| --- | --- |
| `GET /reference/` | 200 `text/html; charset=utf-8`, the scoped policy whose hashes match the inline script and style, `no-store`, `nosniff`; no data |
| `GET /reference` | 301 to `/reference/` |
| `POST /reference/`, `GET /reference/x` | 404, strict policy |
| another `Host` | 421, as every connector page |
| `/api/v1/*` without a token | 401 with the resource metadata challenge (unchanged) |
| register with `<publicUrl>/reference/` | 201; `<publicUrl>/reference/x`, `/reference`, another port or scheme, a query or fragment: 400 |
| callback with `error=access_denied` | "Access was not granted"; connect button; no token request |
| callback with an unknown or reused `state` | refused, no token request, address bar cleaned |
| access token expired | one refresh, then the read is retried once |
| refresh refused (grant revoked, reused) | tokens forgotten, connect step shown |
| connector signed out of SchoolSoft | 409 notice with a link to the owner dashboard |
| a response for another child | section dropped with a notice |
| a lesson title containing markup | shown as text |
| scope unticked at consent | that section says "not granted"; the others render |

</frozen-after-approval>

## Findings for the surface (to be completed as built)

What a UI needs that the REST surface does not give, recorded for E5.4 to E5.8 and E11. The page works around none of them with a private path.

## Code Map

- `src/http/reference/app.ts`: the browser module (OAuth client, reads, week model, rendering).
- `src/http/reference/page.ts`: HTML, inline hashes, scoped policy, routes.
- `src/http/oauth.ts`: extra exact callbacks (`ownCallbacks`).
- `src/http/start.ts`: passes `<publicUrl>/reference/` as the connector's own callback.
- `src/http/server.ts`: mounts the page; dashboard link; consent wording for the connector's own callback.
- `test/unit/reference-app.test.ts`, `test/functional/http-reference.test.ts`, `test/unit/http-oauth.test.ts`, `test/packaging/connector.test.ts`.

## Tasks & Acceptance

- [ ] Given the connector, when a browser opens `/reference/`, then it gets one page with a hash-scoped policy and no data.
- [ ] Given the page, when the owner approves it on the consent page, then it reads the session and renders the selected child's week from the REST routes alone.
- [ ] Given a response for another child, a revoked grant or a signed-out connector, then the page shows no other child's data, returns to the connect step, or links to the owner dashboard.
- [ ] Live acceptance: the page on a parent's deployment against a real SchoolSoft session (E2).

## Verification

See the pull request for the gate results.
