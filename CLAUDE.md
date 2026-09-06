# schoolsoft-agent — working rules

Read `docs/architecture.md` first; it is the source of truth for layout,
boundaries and the test pyramid. `docs/schoolsoft-api.md` holds everything
learned about SchoolSoft's API. This file is only what an agent must obey.

## Rules

- **Layering is enforced.** `src/core` never imports adapters or reads
  `process.env`; adapters import core via `src/core/index.ts` only; adapters
  never import each other (`src/shared` is for common adapter code).
  `make boundaries` and `test/boundary` fail otherwise.
- **Portal routing is static.** A capability is served by the API when one
  exists, by the browser provider only when none does (`PROVIDERS` in
  `src/core/portal/types.ts`). Never add a browser path for something the API
  serves; never let the browser session issue writes without `allowWrites`.
  GDPR-gated capabilities (`WEB_SESSION_CAPABILITIES`) need the web-login
  session from `login --web`; they must fail before navigating without it.
  The web session's only non-GET is the child-in-focus PUT (`syncWebChild`).
- **Browser pages are declared, not scattered.** A page the browser reads
  lives in `src/core/portal/pages.ts` (path, gate, anchors) with its extractor
  in `extractors.ts` and a fixture in `test/fixtures/jsp/`. After a SchoolSoft
  change: `make browser-verify`, fix the named extractor + fixture, then
  `make fingerprints`. Tool inputs take names, never SchoolSoft ids.
- **One definition per capability.** New capability = one file in
  `src/core/operations/` + one line in `registry.ts`. Never hand-write an MCP
  tool or CLI command. Then `make docs && make skills` and commit the output;
  drift tests fail otherwise.
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
  type drives release-please's version bump (see `docs/releasing.md`). No
  session links or trailers.
- **Coverage is 100% and stays there.** New code ships with the tests that
  cover every branch. The only exclusions are the ones listed in
  `.c8rc.json` and inline `c8 ignore` comments, each with the shipped-artifact
  or live test that covers it; never add one without that pointer.
- **Diagrams:** sources in `docs/diagrams/src/*.mmd`, rendered SVGs in `dist/`
  via `make diagrams`; never inline Mermaid in Markdown.

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
ChatGPT are separate specs; see `docs/superpowers/specs/`.
