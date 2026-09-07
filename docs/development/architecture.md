# Architecture

This document goes from the big picture down to the mechanics. If you only read one section, read [The shape of it](#the-shape-of-it). Diagrams are pre-rendered SVGs; click one to open its Mermaid source under [diagrams/src](../diagrams/src) (`make diagrams` re-renders them; see [diagrams/](../diagrams/README.md)).

## The shape of it

One core, local MCP/CLI surfaces and a parent-hosted HTTP connector, many hosts. The core knows SchoolSoft; the surfaces know how agents talk; the hosts are somebody else's software.

[![System overview](../diagrams/dist/system-overview.svg)](../diagrams/src/system-overview.mmd)

One vendor-neutral core, multiple surfaces, many hosts. Everything SchoolSoft-specific sits behind the `SchoolProvider` seam in `src/providers/schoolsoft`; a second vendor is a new directory there. Three rules keep this honest, and a script enforces them (`make boundaries`):

1. `src/core` never imports from an adapter and never reads `process.env`. It receives a `Config` object.
2. Adapters (`src/mcp`, `src/cli`, `src/shared`) import core only through `src/core/index.ts`.
3. Adapters never import each other. Common adapter code lives in `src/shared`.

## One definition per capability

Every capability is an **operation**: a name, a description with "Use when:" guidance, a Zod input schema, safety annotations, and a `run` function that returns plain data.

[![One definition per capability](../diagrams/dist/operation-registry.svg)](../diagrams/src/operation-registry.mmd)

Adding an operation is one new file plus one line in the registry. The MCP tool, the CLI command and three reference documents appear without further work, and a boundary test refuses operations that lack annotations or a "Use when:" line.

## Login, step by step

SchoolSoft's guardian app uses OAuth 2 with PKCE. We use the same flow, with a local callback instead of the app's deep link. The one thing that took real effort to discover: SchoolSoft stamps the **user type** into the token from the OAuth **client id** (`vApp` = guardian app, `eApp` = student app), and resolves the actual user at request time. A guardian with a student-typed token fails every call with "Vi kunde inte hitta användaren".

[![Login, step by step](../diagrams/dist/login-flow.svg)](../diagrams/src/login-flow.mmd)

Two backends serve the data afterwards. The **Eva API** takes the Bearer token and serves profile, lunch, news and messages. The **webview REST** API takes the cookies, which are bound to one child (`childInFocus`), and serves schedule and assignments. Switching child means one more cookie exchange; the operations do that when `child_id` changes.

## Parent-hosted connector

`src/http/` implements a separate Streamable HTTP MCP adapter for a server operated
by one guardian. It imports core through `core/index.ts`; it does not wrap the local
MCP server or CLI. The initial allowlist contains `list_children`, `get_schedule`
and `get_lunch_menu`. Tool definitions come from the operation registry; the runtime
serializes each complete authorization, child-focus and read sequence.

A parent signs into the owner page using their deployment secret and starts
SchoolSoft login there. The provider accepts an injected browser-authorization
callback and an HTTPS redirect URI. PKCE material stays inside the provider; the
HTTP runtime validates one-use state and enforces a deadline. The browser completes
BankID itself. The ordinary local flow retains its localhost callback. **Acceptance
of the public callback by SchoolSoft remains a live-test requirement.**

The runtime pins provider, school and guardian identity. A different guardian is
rejected and the attempted session removed; logout preserves the identity pin.
Each AI app gets OAuth authorization for selected read operations and children.
Unknown or unapproved children are rejected before focusing or fetching, including
an unapproved default child. Listing children returns only the approved subset.
Owner login, CSRF protection, OAuth grants and encrypted persistent state belong to
the HTTP adapter. Per-app revocation is separate from SchoolSoft logout.

The deployment is one process per private state volume. The storage key comes from
the parent's deployment environment; the project author operates no central service.
Hosting administrators may access plaintext during use, and requested results enter
the AI provider's conversation. See [parent setup and trust boundaries](../deployment/connector.md).

The connector is a release candidate with offline security, lifecycle and protocol
tests. HTTP modules are included in the 100% coverage gate. This does not establish
real SchoolSoft callback compatibility, BankID on the same phone, or acceptance by
actual Claude/ChatGPT accounts. Those checks remain explicit before calling the
parent deployment supported.

## Provider seam: one vendor today, room for the next

The capability vocabulary (Portal), the operations and everything generated from them, the session lifecycle, the browser session guard and the two "BankID in the user's own browser" mechanics (localhost callback server, headed-browser cookie capture) are vendor-neutral and live in core. Everything SchoolSoft-specific lives under `src/providers/schoolsoft/` behind the `SchoolProvider` interface (`src/core/provider/types.ts`): which capabilities it serves and how (`routing`), its auth strategies, its API and browser portals, the pages it reads and their fingerprints, and how to recognise its own login pages (`webLogin`). A provider owns its session object (credentials holder) and the persisted `data` blob; core never names a field of it.

The registry in `src/providers/index.ts` maps ids to providers; `config.provider` (env `SCHOOLSOFT_PROVIDER`) selects one and defaults to `schoolsoft`, so nothing changes for current users. `src/core/wiring.ts` is the only core module that may import providers (the boundary checker enforces it); providers import core modules directly, never `core/index.ts`, so there is no import cycle; adapters never see a provider. A capability a provider does not route fails with `CapabilityNotSupportedError` naming the provider.

`test/contract/provider.contract.test.ts` runs the same assertions against every registered provider with no network: routing refers to real capabilities, pages declare anchors, the session serialises to JSON, every strategy implements the whole contract, and the portals cover the routing. A new vendor passes it before it gets a PR. Deliberately deferred until a second vendor exists: normalising the raw JSON capabilities into domain types, and renaming the `SCHOOLSOFT_*` env vars, the `schoolsoft_` tool prefix and the SchoolSoft-specific config keys (`userType`, `clientId`).

Swedish portals all end their login in BankID; the two capture paths above cover an OAuth-style redirect (SchoolSoft) and a plain SAML/e-tjänst web login (everyone else), so a new provider chooses one and writes no browser code.

## Errors and recovery

Every condition a user can meet is an `AgentError` (`src/core/errors`): a **kind** (fixes the exit code and whether a retry can help), a **message key with parameters** (rendered in English or Swedish), and a **hint key** (rendered as a shell command for the CLI or a tool name for MCP). Surfaces call `describeError` and print two lines, the problem and "Next: …"; MCP also returns `error.kind` and `retryable` as structured content. Anything that is not an `AgentError` is a bug and is rendered as one, with a report hint. Exit codes: 2 not authenticated, 3 not configured, 4 network, 5 not available, 6 input, 7 upstream, 1 bug.

Three mitigations remove the common dead ends:

- **Session loss mid-conversation.** `withSessionRecovery` wraps the portal: a 401/403 from the API or a redirect to the login page re-establishes the app session once (refresh + cookie exchange, no user interaction) and repeats the call; a second rejection names `login`. Web-session losses are not retried, because only the user can fix those.
- **Network failures.** `guardNetwork` wraps every HTTP call and turns DNS, TCP, TLS and timeout failures into a `NetworkError` (exit 4, retryable) instead of a raw `ENOTFOUND`.
- **Long logins in hosts that time out.** `login --background` (MCP: `background: true`) returns as soon as the login URL is known. The CLI hands the blocking login to a detached copy of itself so the callback server outlives the command; a pending-login marker in the state directory (`login-pending.json`, no credentials) carries the URL, the process id and the outcome, `auth-status` reports it as `loginInProgress`, and a second `login` refuses to open another window while one is running. Markers of dead processes or older than six minutes are ignored.

## Design principles

The layout is SOLID by construction, and the boundary tests make it stay that way:

| Principle             | Where it shows                                                                                                                                                                                                                                                 | What enforces it                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Single responsibility | one vendor per `src/providers/<id>/`; one backend class per JSON API under its `portal/api/`, `api-portal.ts` only composes; `config.ts` is a pure model, `wiring.ts` builds the object graph; extractors, page specs and the session guard are separate files | review; file headers state the one job                                             |
| Open/closed           | a capability is one operation file + one registry line; a page is one `pages.ts` entry; an auth method is one `AuthStrategy`; tools, commands, docs and skills are generated                                                                                   | drift tests on generated docs and skills                                           |
| Liskov                | fakes implement the same ports as production; `AuthStrategy` has no optional methods                                                                                                                                                                           | type checker (fakes are typed against the port)                                    |
| Interface segregation | each operation declares `portal: [...]` and receives `Pick<Portal, C>`; `ApiPortalPart` / `BrowserPortalPart` split the producer side                                                                                                                          | `test/boundary/registry.test.ts` compares declarations with source                 |
| Dependency inversion  | core sees ports only; store, fetch, browser, spawn, web login and clock are injected with defaults in `wiring.ts`                                                                                                                                              | `make boundaries`, `test/boundary/imports.test.ts`, the 100% offline coverage gate |

## Portal adapter: API first, browser where no API exists

Not everything a guardian sees has a JSON endpoint. Contact lists, subject rooms, bookings and shared files exist only as legacy web pages. Operations therefore talk to a **Portal**, one method per capability, and a static table (`PROVIDERS` in `src/core/portal/types.ts`) says which provider serves each one: the JSON APIs wherever they exist, a headless browser only where they don't. The routing is deterministic and documented; the browser is never used for something the API serves.

[![Portal adapter: API first, browser where no API exists](../diagrams/dist/portal-adapter.svg)](../diagrams/src/portal-adapter.mmd)

The browser provider loads a page with the user's session cookies and runs a self-contained extractor inside it. Its session is read-only by construction: every non-GET request is aborted at the browser (an explicit allowlist exists for the rare read-only POST), and a navigation that lands on the login page or SchoolSoft's "log in again" gate throws a typed error instead of being followed. Playwright is an optional dependency, installed once with `schoolsoft-agent browser install`; the engine is bundled Chromium or, via `SCHOOLSOFT_BROWSER_ENGINE=cdp` and `SCHOOLSOFT_BROWSER_CDP`, any Chrome DevTools Protocol endpoint such as [Obscura](https://github.com/h4ckf0r0day/obscura). Write operations, when they come, use the same seam with writes explicitly allowed per call.

**Coupling to SchoolSoft's HTML is contained.** Every browser-read page is declared once in `src/core/portal/pages.ts` (path, whether it is gated, the anchor selectors a healthy page must contain, and how to obtain an example query when the page needs one). Extractors in `extractors.ts` are the only code that knows the DOM; they run inside the page and are exercised against synthetic fixtures in real Chromium. Two guards catch upstream changes: `schoolsoft-agent browser verify` (also the live suite `07-structure`) loads each page and reports `ok`, `drift`, `broken` or `skipped` per page, comparing anchors and a structural fingerprint (a hash of the page's tag/id/class skeleton, never text) against the values recorded by `make fingerprints` in `fingerprints.ts`. When SchoolSoft ships a redesign the repair is: run `browser verify`, fix the named extractor, refresh its fixture, re-record fingerprints. Everything with a JSON endpoint (including subject rooms, which the React "Ämne" view fetches from the webview REST) is not affected. Ids never cross the tool contract: assessment criteria are requested by subject name and resolved from the subject menu inside the same session.

**Two sessions.** The API session (OAuth tokens + the app cookie exchange) serves everything with a JSON endpoint. SchoolSoft's GDPR gate (grades, student documents, unreported absence, attendance report, assessment criteria, Avstämning) refuses that session outright, so `login --web` captures a second one: a headed browser opens the ordinary web login, the user completes BankID there, and the resulting cookies are stored encrypted next to the tokens. The browser provider carries the web cookies only for gated pages (the two sessions have separate "child in focus" state, so the app cookies stay in charge of contacts, bookings and files), aligns the web session's child with the requested one first (one header GET, and the same PUT the portal's child menu sends when they differ), and refuses gated capabilities without a web session (`WebLoginRequiredError`, before any navigation); the Avstämning REST call sends the same cookie header from the API provider. The web session is never refreshed automatically: it expires on inactivity and the resulting `SessionLostError` names `login --web`.

## Cold start, refresh and the one retry

Access tokens live 15 minutes. Every process start (an MCP server launching, a CLI command) goes through `ensureSession`:

[![Cold start, refresh and the one retry](../diagrams/dist/cold-start-refresh.svg)](../diagrams/src/cold-start-refresh.mmd)

The retry exists because the alternative is a BankID round for the user. Refreshing when the expiry is _unknown_ protects sessions written by older versions.

## Session states

[![Session states](../diagrams/dist/session-states.svg)](../diagrams/src/session-states.mmd)

## Repository layout

```
src/core/         vendor-neutral: provider/ (SchoolProvider seam), auth/ (strategy port, callback server, opener), portal/ (Portal types, guardian, page-spec, inspect, verify, composite), browser/ (session guard, playwright, optional-playwright, install, web-login), session/, operations/, school-directory.ts, config.ts (model), wiring.ts (composition root; the one core file that imports providers), constants.ts, index.ts
src/providers/    one directory per school portal vendor implementing SchoolProvider + index.ts registry
src/providers/schoolsoft/  auth/ (BankID via SchoolSoft OAuth, token/cookie exchange), portal/ (api-portal facade + api/{transport,eva,webview,legacy,web-session}, browser-portal, pages, extractors, fingerprints), routing.ts, session.ts, web-login.ts, schools.ts
src/mcp/          server.ts (registry → tools), respond.ts, index.ts (bin)
src/cli/          flags.ts, program.ts, exit-codes.ts, commands/{configure,doctor,browser}.ts, index.ts (bin)
src/shared/       bootstrap.ts (env + config file → context), version.ts
src/http/         parent-hosted HTTPS adapter: OAuth, owner pages, scoped runtime, encrypted storage and startup
skills/schoolsoft SKILL.md, scripts/schoolsoft.sh, references/commands.md (generated)
plugins/          claude/ (marketplace + two plugins), mcpb/, opencode/, openclaw/, hermes/, pi/
docs/             README.md (index), getting-started/, integrations/ (AI clients), deployment/ (parent hosting), development/, reference/, planning/, diagrams/, assets/
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

`make check` runs everything but E2E with a 100% coverage gate (lines, branches, functions, statements) over the offline suites. What the gate deliberately leaves out, each named in `.c8rc.json` or an inline `c8 ignore` with its reason: the core export barrel, CLI/MCP process entrypoints (covered by `make e2e-artifact`), the HTTP process entrypoint (covered by `test/packaging/connector.test.ts` against the built binary), types-only modules, the in-page extractors (run only inside Chromium, covered by `make e2e-artifact`), the single optional `playwright` import (presence covered by `make e2e-artifact`, absence by the pack smoke), and the live-network defaults for token exchange and the real browser opener (covered by `make e2e`). Environment defaults such as the OS browser opener and the Chromium installer take an injectable spawn so the unit tests cover their branches. `make e2e` runs the live suite; findings accumulate in a gitignored report.

## What lives where at runtime

| Path                            | Contents                                    | Sensitivity   |
| ------------------------------- | ------------------------------------------- | ------------- |
| `<configDir>/config.json`       | school slug, orgId                          | low           |
| `<configDir>/schools.json`      | cached public school list                   | none          |
| `<stateDir>/key.bin` (0600)     | AES key                                     | secret        |
| `<stateDir>/session.enc` (0600) | tokens, cookies, children's names/ids/class | personal data |

`schoolsoft-agent logout` removes the session; deleting the state directory removes everything.
