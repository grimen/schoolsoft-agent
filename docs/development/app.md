# The app (packages/app)

One Expo project (React Native with react-native-web) for web and phones, built on the
REST surface through the typed client `schoolsoft-agent/client`. Design:
[app workspace spec](../planning/specs/2026-09-26-app-workspace.md).

The REST surface and its OAuth endpoints are same-origin only. The app discovers the
connector's own OAuth resource with a same-origin `GET /.well-known/oauth-protected-resource/mcp`,
builds the typed client on that resource's origin (so the `/token` request's `resource` is
right), and sends every request back through the page's own origin. In development the
page origin is the dev proxy below; later (E11.10) the connector serves the app itself and
the two origins are the same.

## Run it against a connector

1. Start a connector (see [the connector guide](../deployment/connector.md)) and sign it in to SchoolSoft.
2. Open its `/reference/` page, connect it and approve at least one child.
3. In that page's browser console, run
   `JSON.parse(sessionStorage.getItem("schoolsoft-reference"))` and copy `client.id` and `refresh`.
4. **Close the reference page tab.** Refresh tokens rotate: if that tab refreshes after the app
   has, the whole connection is revoked. Don't paste one token into two tabs.
5. `make app-web CONNECTOR_URL=http://localhost:3000` (must equal the connector's own
   `SCHOOLSOFT_PUBLIC_URL`; `make app-web` checks this at start-up against the connector's OAuth
   issuer and refuses to start otherwise), then open http://127.0.0.1:8080 (the address it
   prints; not Expo's own port 8081) and paste the two values. Edits reload in the page.

The proxy on port 8080 makes the app and the connector one origin: it forwards `/api/v1/*`,
`/token`, `/revoke` and `/.well-known/*` to the connector, rewriting `Origin` to the
connector's, and everything else to Expo's dev server. It exists only in development. The
REST surface refuses a request whose `Origin` isn't the connector's own, so the rewrite
matters for REST calls that carry `Origin`: non-GET ones, such as future writes. This
flow's REST reads are GETs, which carry no `Origin`; its token refresh is a `POST /token`,
which does, but the connector's token endpoint doesn't check it. So the rewrite itself is
covered by the proxy's own unit tests rather than by `make app-e2e`.

`metro.config.js` resolves `schoolsoft-agent/client` straight to the root's
`dist/client/index.js` (hence `make app-web` builds first): the workspace links the root
package into itself, and Metro's dev server can't bundle through that link.

The children list comes from `GET /api/v1/session` (its `children` field), which any grant
may read, rather than `GET /api/v1/children` (which needs the `list_children` scope a
reference-page grant doesn't have). Children show a first name only.

## Checks

- `make app-check`: lint, typecheck, tests (100% on `src/connection/`, `src/messages.ts`,
  `src/use-children.ts`), proxy tests, a dev-bundle smoke (Expo's live dev server, as
  `make app-web` starts it, must bundle the app), and a production export that must contain no
  development code.
- `make app-e2e`: the connector against the fake portal, a grant from the reference page, and the
  app listing the children in headless Chromium.
- CI runs both in the `App / Test` job when the app, the typed client, the dependencies, or what
  `make app-e2e` runs (the connector's `src/http/`, the fake portal, the Makefile) change. The root
  jobs install the root package only and never see Expo.

## Rules

- The app imports nothing from the root package but `schoolsoft-agent/client` (`make boundaries`).
- The development connect screen never ships in a production build, nor does its text
  (`src/dev/words.ts`, not `src/messages.ts`).
- Sign-in (E11.5) replaces the connect screen; until then, a production build shows a notice.
