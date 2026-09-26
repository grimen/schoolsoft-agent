# Parent-hosted HTTP connector

A Streamable HTTP MCP adapter for **one guardian per deployment**. Parents run it
in their own hosting account. There is no author-operated backend or central store
of families' credentials. Start with the [parent setup guide](../../docs/deployment/connector.md).

This is a release candidate. Offline tests cover implementation behavior; real
SchoolSoft HTTPS callback login and Claude/ChatGPT web/mobile acceptance still need
parent-led tests. The connector exposes children, schedule, calendar and lunch only,
as MCP tools at `/mcp` and as read-only JSON at `/api/v1` for custom UIs.

- `config.ts`, `start.ts`, `index.ts`: deployment validation and startup.
- `server.ts`, `pages.ts`, `owner-session.ts`: HTTP routes, parent pages and owner sessions.
- `oauth.ts`: client registration, consent, PKCE, tokens and revocation.
- `runtime.ts`: remote SchoolSoft login, guardian pin, child consent and serialized reads.
- `routes.ts`, `rest.ts`, `problem.ts`: REST routes generated from the registry, their
  router (same bearer tokens, scopes and runtime as `/mcp`) and problem+json errors.
- `storage.ts`: encrypted persistent state using the parent's deployment key.
- `reference/`: the reference page at `/reference/`, a minimal browser UI that is an
  OAuth client of this connector and reads only `/api/v1` (`app.ts` runs in the
  browser; `page.ts` serves it inline under a hash-scoped policy).

Adapters import core only through `../core/index.js`, never through `src/mcp` or
`src/cli`. HTTP code is included in the offline coverage gate. Keep one process per
state volume. A hosting administrator can access data during processing; encryption
at rest does not remove that trust. Deployment and real acceptance steps are in the
parent guide.
