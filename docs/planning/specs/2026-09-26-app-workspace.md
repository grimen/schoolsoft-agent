---
title: App workspace, one Expo project that lists children from a running connector
type: feature
created: 2026-09-26
status: done
route: dispatch
baseline_commit: origin/main after #70
context:
  - AGENTS.md
  - ROADMAP.md
  - docs/development/architecture.md
  - docs/development/stability.md
  - docs/planning/specs/2026-09-26-openapi-client.md
  - docs/planning/specs/2026-09-26-reference-page.md
  - docs/planning/specs/2026-09-26-composite-overview.md
  - https://github.com/grimen/schoolsoft-agent/issues/37
---

# App workspace: one Expo project that lists children from a running connector (E11.4)

The roadmap decided that the parent-facing app is one Expo project (React, React Native, React Native Web) in this repository, so the API and the app change together. E5.1 to E5.4 and E5.6 gave it a REST surface and a typed client (`schoolsoft-agent/client`), and E5.3 proved the surface is enough for a browser UI. This story creates the workspace and the plumbing, and nothing more. The first screen lists the children a grant covers. Sign-in (E11.5), real screens (E11.6), native builds (E11.7) and serving the app from the connector (E11.10) are later stories. Built offline: no SchoolSoft login.

<frozen-after-approval>

## Intent

A developer runs `make app-web CONNECTOR_URL=http://localhost:3000` against a running connector, connects once with a development connection, and sees the children the grant covers. The repository becomes npm workspaces without the published package, the connector image, the root checks or the root audit getting heavier, slower or different.

Web is the first real target (a browser, a wall display). Native builds must stay possible but are not built here. The app is for the owner's own family first, not a public release.

## Scope

In:

- npm workspaces with `packages/app`, and the fences that keep Expo out of everything that is not the app;
- the Expo project (latest SDK, Expo Router, strict TypeScript);
- a development proxy that makes the app and the connector one origin in development;
- a development-only connection screen;
- the connection plumbing, messages and one hook;
- the children list;
- tests, CI job, make targets, docs.

Out:

- any real sign-in, consent, registration or keychain (E11.5);
- screens beyond the children list (E11.6);
- EAS and native builds (E11.7);
- writes (E11.8);
- full language and accessibility work (E11.9);
- serving the app from the connector and its security policy (E11.10);
- CORS on the connector (E5.7);
- any change to REST routes, the typed client's public API or the connector.

## Workspace and fences

**Layout.** The root `package.json` gains `"workspaces": ["packages/app"]`. The root stays the published `schoolsoft-agent` package: same name, bins, `files`, `exports`, build (`tsc`) and scripts. `packages/app/package.json` is `"private": true` (never published) and depends on `"schoolsoft-agent": "*"`, which npm links to the root.

**The app imports only `schoolsoft-agent/client`** from the root package. A boundary check refuses any other import of `schoolsoft-agent` or of a root `src/` path from `packages/app`. The client already depends on nothing but Zod at run time (E5.4), so the app bundle never pulls in the server.

**Fences.** Each one is enforced by a test or a CI step, not by convention:

| Where | Rule |
| --- | --- |
| Root CI jobs (Checks, Unit, E2E, Publish, Verify) | Install the root package only, with the workspace switched off (`npm ci --workspaces=false`, or the equivalent the plan verifies). They run exactly what they run today. The 100% coverage gate and the boundary tests are unchanged. |
| Local `make check` | Root only, as today. New `make app-check`, `make app-web` and `make app-e2e` cover the app. |
| Connector image | `.dockerignore` excludes `packages/`. The build installs the root package only. A packaging test fails if the image contains anything from `packages/app`. |
| Published tarball | `files` is unchanged. The pack smoke fails if the tarball contains anything from `packages/`. |
| Audit | `audit-ci` keeps auditing the root package's dependencies only. The app job audits the app's dependencies separately. Advisories in Expo's tree that can't be fixed are listed in a documented allowlist with a reason and a review date, never ignored silently. |
| Dependabot | A separate group for `packages/app`, so Expo updates never mix with the core package's updates. |

**Lockfile.** One root `package-lock.json`, as npm workspaces require.

**Verify before relying on it.** The plan's first task proves the root-only install. After `npm ci --workspaces=false` (or the chosen equivalent), `node_modules` holds no `expo`, `react-native` or `react` package, the root gate passes, and the connector image and tarball are byte-for-byte free of the app. If npm can't scope the install this way, stop and bring the finding back before continuing. The fallback would be a separate lockfile for the app, which contradicts the roadmap decision.

## The app

**Tooling.**

- Expo, the latest SDK at the time of the plan, with Expo Router, web through react-native-web, and strict TypeScript.
- The repository's oxlint and prettier configuration, extended for TSX and React where needed.
- `jest-expo` with React Native Testing Library.

**Layout of `packages/app`.**

- `app/_layout.tsx`: the root layout: language, error boundary, the connection provider.
- `app/index.tsx`: the children list.
- `app/dev-connect.tsx`: the development connection screen, present only in development builds.
- `src/connection/`: plumbing (see below).
- `src/messages.ts`: Swedish and English strings.
- `src/use-children.ts`: the one data hook.
- `scripts/dev-proxy.*`: the development proxy, only if Expo's dev server can't host it as middleware (see below).

**Connection plumbing (`src/connection/`).**

- A session-storage `TokenStore` (the client's interface) under the app's own key, `schoolsoft-app-dev`. It holds the client ID and tokens while the tab is open, and it degrades to memory when session storage is unavailable.
- A factory that builds the typed client from the stored connection. It uses `baseUrl` = the page's own origin, the stored client ID, and the language from the device, falling back to English.
- Reading, saving and forgetting the development connection.

**Development connection.** There is no sign-in yet (E11.5), so development uses a grant the reference page already holds. In development builds only, `dev-connect` asks for two values the reference page keeps in its session storage under `schoolsoft-reference`: the client ID (`client.id`) and the refresh token (`refresh`). The screen shows the one-line browser-console command that prints them.

- **Saving:** the app saves them with an empty, already-expired access token (`expiresAt: 0`), so the typed client refreshes before the first request. The client's refresh is single-flight (E5.4).
- **Rotation warning:** refresh tokens rotate. After the first refresh, the reference page's copy is spent, and if that tab refreshed later, the reuse would revoke the whole grant. The screen says so plainly: close the reference page tab before connecting.
- **Not in production:** the route and its code are excluded from production builds. Without a connection, a production build shows a notice that sign-in arrives in a later version.

**Development proxy.** The REST surface is same-origin only (no CORS until E5.7), so the browser must see one origin. `make app-web CONNECTOR_URL=…` serves the app from one address that forwards:

- `/api/v1/*`;
- the OAuth endpoints the typed client calls (token and revocation, at the paths the connector's metadata names);
- `/.well-known/*`.

Everything else, including the dev server's hot-reload socket, goes to Expo's web dev server. The proxy rewrites nothing in the requests or responses except the upstream address. The plan picks the mechanism: dev-server middleware if the pinned Expo SDK supports it cleanly, otherwise a small Node proxy started by the make target. Either way it's a development dependency and never part of an export.

**Children list (`app/index.tsx`).** It uses `useChildren()`, which calls `client.children()` and yields one of four states:

- `loading`;
- `list`: each child's first name, school and class, as far as the connector provides them;
- `empty`: the grant covers no children;
- `error`.

Changing or forgetting the connection resets the hook, so an answer from an earlier connection is never shown.

**Errors.** `src/messages.ts` maps every `ConnectorError` kind the client can raise to a Swedish and an English message and a next step. For example, a lost or revoked grant says "connect again", a SchoolSoft session that needs a login points to the connector's dashboard, and the connector pushing back says "try again later". The error state offers retry and "forget this connection" (clears the token store and returns to `dev-connect` in development).

## Testing and CI

**Quality bar (split).**

- `src/connection/`, `src/messages.ts` and `src/use-children.ts` are held to 100% lines, branches, functions and statements, enforced by the app job.
- Screens get component tests for every state but no coverage threshold.

**Plumbing tests.**

- The token store saves, loads and clears, and falls back to memory when session storage throws.
- The factory uses the page origin and the stored client ID. With an expired access token, several concurrent calls cause exactly one refresh request.
- Every `ConnectorError` kind has both messages. A test enumerates the kinds from the client, so a new kind without messages fails.
- The hook goes loading → list, empty and error. It ignores a late answer after the connection changes.

**Screen tests.**

- The children list in each state, from fixtures typed with the client's generated types.
- `dev-connect` validates its two fields, saves, and shows the rotation warning.

**Production safety.**

- The app job runs `expo export --platform web`. A test asserts the bundle has no `dev-connect` route and no proxy code.
- The tarball and image tests from the fences table.
- The import boundary check.

**End to end (`make app-e2e`).**

1. Start the connector against the fake portal, using the same setup as the reference-page E2E test.
2. Obtain a grant through the reference page's automated sign-in and consent.
3. Start `make app-web` with the proxy.
4. In headless Chromium, paste the client ID and refresh token through `dev-connect`.
5. Assert the page lists the fake children, and that no request went anywhere but the proxy's origin.

It never contacts SchoolSoft.

**CI.**

- **New job `App / Test`:** it installs the app workspace and runs lint, typecheck, the tests with the split gate, the web export check, the E2E test and the app audit.
- **When it runs:** when `packages/app/**`, `src/client/**` or the root lockfile changes. `checks.yml` classifies changes the same way it does for docs-only changes.
- **Root jobs:** unchanged apart from the scoped install.

## I/O and edge cases

- **The connector is unreachable or `CONNECTOR_URL` is wrong:** `make app-web` refuses to start, naming the URL, instead of serving an app that fails on every request.
- **The pasted refresh token is spent or revoked:** the first refresh fails, the app shows "connect again", and it clears the stored connection.
- **Session storage is unavailable** (private mode or a blocked storage policy): the connection lives in memory for the page's lifetime, and the screen says it won't survive a reload.
- **Two app tabs with one connection:** each tab has its own session storage, so a connection pasted in one tab isn't in the other. Pasting the same refresh token into two tabs would reuse it after rotation and revoke the grant. The `dev-connect` screen warns about this. The proper fix is E11.5's shared registration.
- **The typed client's validation fails (drift):** it shows as an error state with the message for that kind, never as partial data.

## Code

Paths are proposals for the plan to confirm. Beyond `packages/app/**`, this story touches:

- root `package.json` (workspaces);
- `.dockerignore`;
- `Dockerfile.connector` (the install command, if needed);
- `Makefile` (`app-check`, `app-web`, `app-e2e`);
- `.github/workflows/ci.yml` and `checks.yml` (the app job, the root-only install, change classification);
- `.github/dependabot.yml`;
- `scripts/check-boundaries.ts` (app import rule);
- `scripts/pack-smoke.sh` (no `packages/` in the tarball);
- `test/packaging/*` (image and tarball fences);
- `docs/development/app.md` (new);
- `docs/development/architecture.md`;
- `CONTRIBUTING.md`;
- `ROADMAP.md` (E11.4 done in the PR).

It doesn't touch `src/` or any published surface. If the plan finds it must, that's a finding to bring back.

</frozen-after-approval>

## Clarifications (as built)

Found during planning and implementation; none changes the frozen scope above.

1. **Origin rewrite.** The REST surface refuses a request whose `Origin` is not the
   connector's `publicUrl` (`src/http/rest.ts:90`). The dev proxy therefore sets `Origin`
   to the connector's origin on connector-bound requests, and `CONNECTOR_URL` must equal
   the connector's `SCHOOLSOFT_PUBLIC_URL`. Nothing else is rewritten except the upstream
   address and `Host`.
2. **The `/dev-connect` route in production.** Expo Router routes are files, so the route
   file ships in every build. In production it only redirects to `/`, and the development
   component is `require`d behind `__DEV__`, so the minifier removes it, together with
   its text (`src/dev/words.ts`, not `messages.ts`). The production export check
   (`check-export.mjs`) asserts the development code is absent (marker strings, including
   the connect screen's warning text). Jest tests run with `__DEV__` false and assert the
   production branches: `/dev-connect` redirects to `/` without loading the development
   screen, and `/` shows the sign-in notice.
3. **Children show a first name only.** `GET /api/v1/children` returns `{ id, firstName }`
   per child; the spec's "school and class, as far as the connector provides them" means
   first names today.
4. **E2E build.** `make app-e2e` serves a development-mode static export
   (`expo export --platform web --dev`) through the same proxy, instead of the live dev
   server, for speed and determinism. `make app-web` uses the live dev server, which that
   export never exercises, so `make app-check` also runs a dev-bundle smoke
   (`scripts/dev-bundle-smoke.mjs`): it starts Expo's dev server as `make app-web` does
   and fetches the web entry bundle. See 8.
5. **The typed client's `resource` needs the connector's own origin (R16).** The
   connector's OAuth `resource` must equal its own public URL, which differs from the
   page (proxy) origin the app is served from. `clientFor` discovers the connector's
   resource via a same-origin `GET /.well-known/oauth-protected-resource/mcp`, builds the
   typed client with that resource's origin as `baseUrl`, and wraps `fetch` so every
   request is actually sent to the page origin — the identity when the two already match.
6. **The children list reads `/api/v1/session`, not `/api/v1/children` (R17).** A grant
   from the reference page requests only `get_schedule`/`get_lunch_menu`/`get_calendar`
   and consent can't widen it, so it never has the `list_children` scope
   `GET /api/v1/children` needs. `useChildren` reads the session's own `children` field
   instead, which any grant may read; a SchoolSoft session that needs a new sign-in
   surfaces as its own error state, carrying the connector's dashboard link.
7. **The Origin rewrite proof, and what it actually covers (R18).** This flow's REST reads
   are same-origin `GET`s, which carry no `Origin` header. Its token refresh is a
   same-origin `POST /token`, which does carry `Origin` (the proxy rewrites it), but the
   connector's token endpoint doesn't check `Origin`. So `make app-e2e` cannot exercise
   the rewrite by disabling it. Instead it proves a load-bearing part of the same proxy
   (the E2E fails when `/api/v1/*` isn't forwarded, and passes again once restored); the
   `Origin` rewrite itself is covered by the proxy's unit tests (`dev-proxy.test.mjs`)
   and matters for REST calls that carry `Origin`: non-`GET` ones, such as future writes.
8. **Metro resolves the typed client directly (R20).** The workspace links the root
   package into itself (`node_modules/schoolsoft-agent -> ..`). Metro's dev server failed
   to bundle through that link ("Failed to collapse" in its file map; `expo export` was
   unaffected), and no gate noticed, because 4 moved the E2E to a static export. The
   app's `metro.config.js` resolves `schoolsoft-agent/client` straight to the root's
   `dist/client/index.js`, and the dev-bundle smoke in `make app-check` guards it.
   `make app-web` runs Expo without `CI=1`, so Metro watches and reloads.

## Tasks & Acceptance

- [ ] Given a clean checkout, when the root CI install runs, then no Expo, React Native or React package is installed, and the root gate, the tarball and the connector image are unchanged.
- [ ] Given `packages/app`, when the app job runs, then lint, typecheck, the split coverage gate, the web export check and the app audit pass.
- [ ] Given a running connector and a grant from the reference page, when a developer runs `make app-web` and connects through `dev-connect`, then the page lists the grant's children (proven by `make app-e2e`).
- [ ] Given a production web export, then it contains no development connection route or proxy code.
- [ ] Given any app file, when it imports from the root package other than `schoolsoft-agent/client`, then the boundary check fails.

## Verification

See the pull request for the gate results.
