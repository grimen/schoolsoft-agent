# schoolsoft-agent — working rules for agents

Canonical rules file, read by every coding agent (Claude Code loads it through
`CLAUDE.md`; OpenCode, Codex, Hermes and Pi read `AGENTS.md` directly).

Read `docs/development/architecture.md` first; it is the source of truth for layout,
boundaries and the test pyramid. `docs/reference/schoolsoft-api.md` holds everything
learned about SchoolSoft's API. This file is only what an agent must obey.

## Rules

- **Layering is enforced.** `src/core` never imports adapters or reads
  `process.env`; adapters import core via `src/core/index.ts` only; adapters
  never import each other (`src/shared` is for common adapter code).
  Vendors live in `src/providers/<id>/` behind `SchoolProvider`: only
  `src/core/wiring.ts` imports a provider, providers import core modules
  directly (never `core/index.ts`), adapters never import a provider.
  `make boundaries` and `test/boundary` fail otherwise.
- **Nothing SchoolSoft-specific in core.** URLs, endpoints, DOM, login
  markers, token shapes and persisted credentials belong to
  `src/providers/schoolsoft/`. Core owns the capability vocabulary, the
  operations, the session lifecycle and the BankID-in-own-browser mechanics.
  A new vendor = one provider directory + one registry line, passing
  `test/contract`. Deferred on purpose until a second vendor exists:
  domain types for the raw JSON capabilities and renaming `SCHOOLSOFT_*`,
  the `schoolsoft_` tool prefix and the `userType`/`clientId` config keys.
- **Portal routing is static.** A capability is served by the API when one
  exists, by the browser provider only when none does (`ROUTING` in
  `src/providers/schoolsoft/routing.ts`). Never add a browser path for something the API
  serves; never let the browser session issue writes without `allowWrites`.
  GDPR-gated capabilities (`WEB_SESSION_CAPABILITIES`) need the web-login
  session from `login --web`; they must fail before navigating without it.
  The web session's only non-GET is the child-in-focus PUT (`syncWebChild`).
- **Browser pages are declared, not scattered.** A page the browser reads
  lives in the provider's `portal/pages.ts` (path, gate, anchors) with its
  extractor in `portal/extractors.ts` and a fixture in `test/fixtures/jsp/`. After a SchoolSoft
  change: `make browser-verify`, fix the named extractor + fixture, then
  `make fingerprints`. Tool inputs take names, never SchoolSoft ids.
- **One definition per capability.** New capability = one file in
  `src/core/operations/` + one line in `registry.ts`. Never hand-write an MCP
  tool or CLI command. Then `make docs && make skills` and commit the output;
  drift tests fail otherwise.
- **Errors are for users, not developers.** Any condition a user can meet is
  an `AgentError` (`src/core/errors`) with a kind, a message key in both
  languages and a hint key; never a raw `Error` with prose. Surfaces render
  via `describeError` (two lines: problem, "Next: …"); exit codes follow the
  kind. New messages go into `errors/messages.ts` in English and Swedish.
  A raw `Error` reaching a user is treated as a bug (exit 1) by design.
- **Never automate BankID.** Login opens the user's browser; the CLI prints
  the URL too.
- **Children's data stays out of git and logs.** `e2e-report.md`,
  `e2e-session-dump.json`, state dirs are ignored. Probes that print API
  responses must redact names, subjects and message bodies.
- **Gates before any push:** `make check` (lint, typecheck, format, boundaries,
  manifests, tests with a 100% coverage gate), `make check-ci`, `make e2e-artifact`. `make e2e`
  runs the live suite locally only, never in CI. Hooks (lefthook) run the cheap
  ones on commit/push; CI (`ci.yml`) stages Checks → Unit → E2E → Publish.
- **Independence:** SchoolSoft is a trademark of SchoolSoft AB and BankID of
  Finansiell ID-Teknik BID AB; neither is involved in this project. Keep every
  user-facing text and illustration clear about that, name them only
  descriptively, never use their logos or brand assets, never imply endorsement.
- **Commits:** Conventional Commits, scopes from `commitlint.config.mjs`; the
  type drives release-please's version bump (see `docs/development/releasing.md`). No
  session links or trailers.
- **Coverage is 100% and stays there.** New code ships with the tests that
  cover every branch. The only exclusions are the ones listed in
  `.c8rc.json` and inline `c8 ignore` comments, each with the shipped-artifact
  or live test that covers it; never add one without that pointer.
- **Diagrams:** sources in `docs/diagrams/src/*.mmd`, rendered SVGs in `dist/`
  via `make diagrams`; never inline Mermaid in Markdown.

## Design principles (SOLID, enforced)

Keep the code SOLID; the boundary tests fail when it drifts.

- **Single responsibility.** One file, one job. A vendor is one provider
  directory; a backend is one class over the provider's transport
  (`portal/api/*.ts`); `api-portal.ts` only composes them. Config is a pure model (`config.ts`); object graphs are
  built in `wiring.ts`; extractors know the DOM, page specs know structure,
  the session guard knows safety. A file that starts doing two of these is
  split, not grown.
- **Open/closed.** Extend by adding a file and a registry line: a vendor in
  `src/providers/`, an operation in `operations/`, a page in the provider's
  `pages.ts`, a backend class in its `portal/api/`, an auth strategy
  implementing `AuthStrategy<S>`. Existing code is not edited
  to add a capability; the MCP tool, CLI command, docs and skills are
  generated from the definition.
- **Liskov.** Every implementation of a port honours its whole contract:
  fakes implement the same interface as production (no optional methods on
  `AuthStrategy`, `Portal` or `BrowserSession`), and a test that needs a
  fake writes one against the port, not an `as never` cast around a partial.
- **Interface segregation.** An operation declares the portal capabilities
  it uses (`portal: [...]` in `defineOperation`) and receives only those
  (`Pick<Portal, C>`); the boundary test checks the declaration against the
  source. Helpers take the narrowest context they need
  (`Pick<OperationContext, "manager">`). Producers are split the same way
  (`ApiPortalPart` / `BrowserPortalPart`).
- **Dependency inversion.** Core depends on ports (`SchoolProvider`,
  `ProviderSession`, `AuthStrategy<S>`, `BrowserSession`, `SessionStore`),
  never on a vendor, Playwright, the filesystem, the network, the clock or
  the process: store, fetch,
  browser session, playwright loader, spawn, web login and `now` are all
  injected with a production default in `wiring.ts`. `src/core` imports no
  adapter and reads no `process.env`; `make boundaries` enforces it. This is
  what lets the offline suite reach 100% without touching the network.

When a change bends one of these, name the principle in the PR and say why
it is the smaller evil; do not let it pass silently.

## Live facts that shape the code (Täby, 2026-09-06)

- Guardian tokens require login route `parent` **and** client id `vApp`;
  `eApp` mints STUDENT tokens that fail everything with "Vi kunde inte hitta
  användaren".
- Cookie exchange (`/eva-apps/auth/login/parent`) needs `userId`, `orgId`,
  `childInFocus` headers; cookies are bound to one child.
- Access token 15 min (JWT `exp`, persisted); refresh rotates; refresh
  lifetime unknown (E2E D3 snapshots track it).
- `@elias4044/ssp-node` is student-only: HTTP helpers and token holder only.

## Commands

`make help` lists everything. Common: `make setup`, `make check`,
`make e2e` (needs `SCHOOLSOFT_SCHOOL` or `configure` + one login),
`make docs`, `make skills`, `make diagrams`, `make plugin-validate`, `make check-ci`.
Release: merge the release-please PR (`make release`); `make version` shows what CI would publish.

Gotcha: the rtk shell hook rewrites `npx tsx`; call `./node_modules/.bin/tsx`.

## Next specs

Write operations (absence, messages) and the remote HTTP transport for
ChatGPT are separate specs; see `docs/planning/specs/`.
