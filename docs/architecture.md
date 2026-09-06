# Architecture

This document goes from the big picture down to the mechanics. If you only read one section, read [The shape of it](#the-shape-of-it). Diagrams are pre-rendered SVGs; click one to open its Mermaid source under [diagrams/src](diagrams/src/) (`make diagrams` re-renders them; see [diagrams/](diagrams/README.md)).

## The shape of it

One core, two surfaces, many hosts. The core knows SchoolSoft; the surfaces know how agents talk; the hosts are somebody else's software.

[![System overview](diagrams/dist/system-overview.svg)](diagrams/src/system-overview.mmd)

Three rules keep this honest, and a script enforces them (`make boundaries`):

1. `src/core` never imports from an adapter and never reads `process.env`. It receives a `Config` object.
2. Adapters (`src/mcp`, `src/cli`, `src/shared`) import core only through `src/core/index.ts`.
3. Adapters never import each other. Common adapter code lives in `src/shared`.

## One definition per capability

Every capability is an **operation**: a name, a description with "Use when:" guidance, a Zod input schema, safety annotations, and a `run` function that returns plain data.

[![One definition per capability](diagrams/dist/operation-registry.svg)](diagrams/src/operation-registry.mmd)

Adding an operation is one new file plus one line in the registry. The MCP tool, the CLI command and three reference documents appear without further work, and a boundary test refuses operations that lack annotations or a "Use when:" line.

## Login, step by step

SchoolSoft's guardian app uses OAuth 2 with PKCE. We use the same flow, with a local callback instead of the app's deep link. The one thing that took real effort to discover: SchoolSoft stamps the **user type** into the token from the OAuth **client id** (`vApp` = guardian app, `eApp` = student app), and resolves the actual user at request time. A guardian with a student-typed token fails every call with "Vi kunde inte hitta användaren".

[![Login, step by step](diagrams/dist/login-flow.svg)](diagrams/src/login-flow.mmd)

Two backends serve the data afterwards. The **Eva API** takes the Bearer token and serves profile, lunch, news and messages. The **webview REST** API takes the cookies, which are bound to one child (`childInFocus`), and serves schedule and assignments. Switching child means one more cookie exchange; the operations do that when `child_id` changes.

## Design principles

The layout is SOLID by construction, and the boundary tests make it stay that way:

| Principle             | Where it shows                                                                                                                                                                                                       | What enforces it                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Single responsibility | one backend class per JSON API under `portal/api/`, `api-portal.ts` only composes; `config.ts` is a pure model, `wiring.ts` builds the object graph; extractors, page specs and the session guard are separate files | review; file headers state the one job                                             |
| Open/closed           | a capability is one operation file + one registry line; a page is one `pages.ts` entry; an auth method is one `AuthStrategy`; tools, commands, docs and skills are generated                                         | drift tests on generated docs and skills                                           |
| Liskov                | fakes implement the same ports as production; `AuthStrategy` has no optional methods                                                                                                                                 | type checker (fakes are typed against the port)                                    |
| Interface segregation | each operation declares `portal: [...]` and receives `Pick<Portal, C>`; `ApiPortalPart` / `BrowserPortalPart` split the producer side                                                                                | `test/boundary/registry.test.ts` compares declarations with source                 |
| Dependency inversion  | core sees ports only; store, fetch, browser, spawn, web login and clock are injected with defaults in `wiring.ts`                                                                                                    | `make boundaries`, `test/boundary/imports.test.ts`, the 100% offline coverage gate |

## Portal adapter: API first, browser where no API exists

Not everything a guardian sees has a JSON endpoint. Contact lists, subject rooms, bookings and shared files exist only as legacy web pages. Operations therefore talk to a **Portal**, one method per capability, and a static table (`PROVIDERS` in `src/core/portal/types.ts`) says which provider serves each one: the JSON APIs wherever they exist, a headless browser only where they don't. The routing is deterministic and documented; the browser is never used for something the API serves.

[![Portal adapter: API first, browser where no API exists](diagrams/dist/portal-adapter.svg)](diagrams/src/portal-adapter.mmd)

The browser provider loads a page with the user's session cookies and runs a self-contained extractor inside it. Its session is read-only by construction: every non-GET request is aborted at the browser (an explicit allowlist exists for the rare read-only POST), and a navigation that lands on the login page or SchoolSoft's "log in again" gate throws a typed error instead of being followed. Playwright is an optional dependency, installed once with `schoolsoft-agent browser install`; the engine is bundled Chromium or, via `SCHOOLSOFT_BROWSER_ENGINE=cdp` and `SCHOOLSOFT_BROWSER_CDP`, any Chrome DevTools Protocol endpoint such as [Obscura](https://github.com/h4ckf0r0day/obscura). Write operations, when they come, use the same seam with writes explicitly allowed per call.

**Coupling to SchoolSoft's HTML is contained.** Every browser-read page is declared once in `src/core/portal/pages.ts` (path, whether it is gated, the anchor selectors a healthy page must contain, and how to obtain an example query when the page needs one). Extractors in `extractors.ts` are the only code that knows the DOM; they run inside the page and are exercised against synthetic fixtures in real Chromium. Two guards catch upstream changes: `schoolsoft-agent browser verify` (also the live suite `07-structure`) loads each page and reports `ok`, `drift`, `broken` or `skipped` per page, comparing anchors and a structural fingerprint (a hash of the page's tag/id/class skeleton, never text) against the values recorded by `make fingerprints` in `fingerprints.ts`. When SchoolSoft ships a redesign the repair is: run `browser verify`, fix the named extractor, refresh its fixture, re-record fingerprints. Everything with a JSON endpoint (including subject rooms, which the React "Ämne" view fetches from the webview REST) is not affected. Ids never cross the tool contract: assessment criteria are requested by subject name and resolved from the subject menu inside the same session.

**Two sessions.** The API session (OAuth tokens + the app cookie exchange) serves everything with a JSON endpoint. SchoolSoft's GDPR gate (grades, student documents, unreported absence, attendance report, assessment criteria, Avstämning) refuses that session outright, so `login --web` captures a second one: a headed browser opens the ordinary web login, the user completes BankID there, and the resulting cookies are stored encrypted next to the tokens. The browser provider carries the web cookies only for gated pages (the two sessions have separate "child in focus" state, so the app cookies stay in charge of contacts, bookings and files), aligns the web session's child with the requested one first (one header GET, and the same PUT the portal's child menu sends when they differ), and refuses gated capabilities without a web session (`WebLoginRequiredError`, before any navigation); the Avstämning REST call sends the same cookie header from the API provider. The web session is never refreshed automatically: it expires on inactivity and the resulting `SessionLostError` names `login --web`.

## Cold start, refresh and the one retry

Access tokens live 15 minutes. Every process start (an MCP server launching, a CLI command) goes through `ensureSession`:

[![Cold start, refresh and the one retry](diagrams/dist/cold-start-refresh.svg)](diagrams/src/cold-start-refresh.mmd)

The retry exists because the alternative is a BankID round for the user. Refreshing when the expiry is _unknown_ protects sessions written by older versions.

## Session states

[![Session states](diagrams/dist/session-states.svg)](diagrams/src/session-states.mmd)

## Repository layout

```
src/core/         auth/, portal/ (types, guardian, pages, extractors, verify, fingerprints, browser-portal, composite, api-portal + api/{transport,eva-api,webview-api,legacy-api,web-session-api}), browser/ (session, playwright, optional-playwright, install, web-login), session/, operations/, config.ts (model), wiring.ts (composition root), constants.ts, index.ts
src/mcp/          server.ts (registry → tools), respond.ts, index.ts (bin)
src/cli/          flags.ts, program.ts, exit-codes.ts, commands/{configure,doctor,browser}.ts, index.ts (bin)
src/shared/       bootstrap.ts (env + config file → context), version.ts
src/http/         reserved for the remote transport (next spec)
skills/schoolsoft SKILL.md, scripts/schoolsoft.sh, references/commands.md (generated)
plugins/          claude/ (marketplace + two plugins), mcpb/, opencode/, openclaw/, hermes/, pi/
docs/             this file, schoolsoft-api.md, hosts/, reference/ (generated)
scripts/          check-boundaries, gen-docs, gen-skills, validate-plugins, e2e-login
test/             unit/, boundary/, functional/, packaging/, e2e/, helpers/
```

## Configuration

Precedence: CLI flags → `SCHOOLSOFT_*` environment → `config.json` → defaults.

| Key            | Env                        | Default                                  |
| -------------- | -------------------------- | ---------------------------------------- |
| `school`       | `SCHOOLSOFT_SCHOOL`        | required; `configure` finds it by name   |
| `orgId`        | `SCHOOLSOFT_ORGID`         | from the child's profile                 |
| `userType`     | `SCHOOLSOFT_USER_TYPE`     | `parent`                                 |
| `clientId`     | `SCHOOLSOFT_CLIENT_ID`     | `vApp` for parent, `eApp` otherwise      |
| `callbackPort` | `SCHOOLSOFT_CALLBACK_PORT` | `43117`                                  |
| `configDir`    | `SCHOOLSOFT_CONFIG_DIR`    | platform config dir (`doctor` prints it) |
| `stateDir`     | `SCHOOLSOFT_STATE_DIR`     | `<configDir>/state`                      |

## Testing

| Layer      | Where              | What it proves                                                                                                          | Network               |
| ---------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------- | --------------------- |
| Unit       | `test/unit`        | OAuth, cookie exchange, guardian API paths, school ranking, session manager, strategy sequence, config, flag derivation | none (injected fetch) |
| Boundary   | `test/boundary`    | import rules, registry invariants, generated docs equal committed, doc links and diagrams                               | none                  |
| Functional | `test/functional`  | real MCP client over in-memory transport; CLI program in-process; one spawn of the built bin                            | none                  |
| Packaging  | `test/packaging`   | every host manifest validates; skill follows the Agent Skills spec; per-host skill builds                               | none                  |
| E2E        | `test/e2e` (gated) | the real thing: BankID once, then silent restore, forced refresh, every operation over stdio and CLI, child switching   | SchoolSoft            |

`make check` runs everything but E2E with a 100% coverage gate (lines, branches, functions, statements) over the offline suites. What the gate deliberately leaves out, each named in `.c8rc.json` or an inline `c8 ignore` with its reason: barrel files, the HTTP transport skeleton, types-only modules, the in-page extractors (run only inside Chromium, covered by `make e2e-artifact`), the single optional `playwright` import (presence covered by `make e2e-artifact`, absence by the pack smoke), and the live-network defaults for token exchange and the real browser opener (covered by `make e2e`). Environment defaults such as the OS browser opener and the Chromium installer take an injectable spawn so the unit tests cover their branches. `make e2e` runs the live suite; findings accumulate in a gitignored report.

## What lives where at runtime

| Path                            | Contents                                    | Sensitivity   |
| ------------------------------- | ------------------------------------------- | ------------- |
| `<configDir>/config.json`       | school slug, orgId                          | low           |
| `<configDir>/schools.json`      | cached public school list                   | none          |
| `<stateDir>/key.bin` (0600)     | AES key                                     | secret        |
| `<stateDir>/session.enc` (0600) | tokens, cookies, children's names/ids/class | personal data |

`schoolsoft-agent logout` removes the session; deleting the state directory removes everything.
