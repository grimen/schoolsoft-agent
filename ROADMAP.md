# Roadmap

What is planned, in the order it is worth doing. Epics are ordered by priority; stories
inside an epic are ordered by dependency. A story is small enough for one pull request
and says how to tell it is done. Design detail belongs in a dated spec under
[docs/planning/specs](docs/planning/specs/), written before the code; this file only says
what and why.

Status as of 2026-09-26. Tags: **offline** can be built and verified without a SchoolSoft
login; **live** needs one guardian BankID session; **owner** needs the repository owner.

| Epic                                                                                                      | Goal                                                              | State                                       |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------- |
| [E1](#e1-land-the-stack) ([#24](https://github.com/grimen/schoolsoft-agent/issues/24))                    | Merge and release what is built                                   | E1.1 done; release not published (#55, #56) |
| [E2](#e2-one-live-acceptance-session) ([#25](https://github.com/grimen/schoolsoft-agent/issues/25))       | Verify every offline assumption in one BankID login               | blocked on a live session; E2.1 ready       |
| [E3](#e3-contracts-that-can-change) ([#26](https://github.com/grimen/schoolsoft-agent/issues/26))         | Make later changes non-breaking                                   | E3.1–E3.3 done                              |
| [E4](#e4-typed-domain-model) ([#27](https://github.com/grimen/schoolsoft-agent/issues/27))                | Stable, validated outputs instead of raw portal JSON              | E4.1–E4.4 done                              |
| [E5](#e5-rest-surface-for-custom-uis) ([#28](https://github.com/grimen/schoolsoft-agent/issues/28))       | A plain HTTP API a custom UI can build on                         | E5.1, E5.2 done; E5.3 in review (#57)       |
| [E6](#e6-a-good-citizen-towards-the-portal) ([#29](https://github.com/grimen/schoolsoft-agent/issues/29)) | Never be the reason the portal blocks the client                  | E6.1, E6.2 done                             |
| [E7](#e7-write-operations) ([#30](https://github.com/grimen/schoolsoft-agent/issues/30))                  | Safe writes beyond the first one                                  | first write merged (#21)                    |
| [E8](#e8-session-longevity-live-half) ([#8](https://github.com/grimen/schoolsoft-agent/issues/8))         | Fewer BankID logins, from measured lifetimes                      | offline half merged (#22)                   |
| [E9](#e9-connector-hardening-follow-ups) ([#31](https://github.com/grimen/schoolsoft-agent/issues/31))    | Close the documented security leftovers                           | not started                                 |
| [E10](#e10-supportability) ([#32](https://github.com/grimen/schoolsoft-agent/issues/32))                  | Bug reports a non-technical parent can produce                    | not started                                 |
| [E11](#e11-user-experience) ([#33](https://github.com/grimen/schoolsoft-agent/issues/33))                 | What a parent looks at: CLI, TUI, one Expo app for web and phones | E11.1 done                                  |
| [Later](#later)                                                                                           | Worth doing, not yet worth scheduling                             |                                             |

Naming stays as it is: this is a SchoolSoft project today, and the `schoolsoft_` tool
prefix, the `SCHOOLSOFT_*` settings and the package name are kept. Another portal, if one
comes, is added behind the existing provider seam and decorated on top; it does not
justify a rename now.

## E1. Land the stack

Four pull requests formed one stack: #16 (parent-hosted connectors) ← #20 (connector
hardening) ← #21 (absence report) ← #22 (session longevity). All four merged on
2026-09-26 with CI on `main` green, followed by #45 to #54. The release after them was
tagged but not published; #56 collects what is left.

- **E1.1 Merge bottom-up** (owner; done). #16, then #20, #21, #22, each into `main` after
  retargeting. Done when `main` holds all four and CI on `main` is green.
- **E1.2 Code scanning on stacked work** (offline). Default setup analyses pull requests
  into `main` only, so stacked pull requests go unanalysed. Switch to an advanced-setup
  workflow that also runs on pull requests into `feat/**`, or document the temporary
  pull request workaround in CONTRIBUTING. Done when a stacked pull request shows a CodeQL
  check.
- **E1.3 Release 0.3.0** (owner). Merge the release pull request (#9) after E3.1 and E3.2,
  since those are the changes that become breaking once published. Done when the version
  is on GitHub Packages. Tagged, not published; see #56.
- **E1.4 Publish to npm** (owner). Add the `NPM_TOKEN` secret; publishing is already wired
  and skips without it. Done when the `npx` lines in the parent guides work as written.
  Listed in #56.
- **E1.5 Retire stale worktrees and branches** (owner). The merged feature worktrees
  under `~/Dev/schoolsoft-agent-*` and the old `schoolsoft-mcp-server` checkout.
- **E1.6 First published release** ([#56](https://github.com/grimen/schoolsoft-agent/issues/56)) (owner).
  `v0.3.0` exists as a tag and a GitHub Release with no package: the plugin manifests were
  still at 0.2.0, so Checks failed and Publish never ran. Merge #55 (the manifests follow
  `package.json`), give the Publish job the permission its bundle upload needs, approve
  and merge the 0.3.1 release pull request, and watch the first release run end to end.
  Done when 0.3.1 is on GitHub Packages with the bundle attached and Verify passed at the
  tag.

## E2. One live acceptance session

Everything below was built against fakes. One login should settle all of it, so the
session is prepared first and spent once.

- **E2.1 Capture probe** (offline; done in #46). `make capture`: with an existing session,
  record the structures the offline work guessed at as redacted fixtures (no names,
  subjects or message bodies): the absence, leave and message forms, the Översikt page, a
  non-empty school-event response. Done when one command produces fixtures that pass the
  redaction check. It has not run against a real session yet; that is the first step of
  the live session.
- **E2.2 Connector acceptance** (live). SchoolSoft accepting the public HTTPS callback,
  a real BankID completion, Claude and ChatGPT consent and tool calls on web and mobile,
  restart and refresh with a real session. Done when the checklist in
  [docs/deployment/connector.md](docs/deployment/connector.md) is ticked.
- **E2.3 Proxy hops per hosting route** (live). Confirm `SCHOOLSOFT_PROXY_HOPS` for
  Cloudflare Tunnel and Render with the owner dashboard's address check; correct the
  guides. Done when neither guide says "unconfirmed".
- **E2.4 Absence report body** (live). Correct `toAbsenceNoticeBody`, the success status,
  part-day semantics, redirect behaviour and which session the endpoint needs. Done when
  one real report, made with consent for a real absence, is registered and the spec's
  assumed column is empty.
- **E2.5 Calendar details** (live). End-date inclusivity and the non-empty event shape.
- **E2.6 Översikt page** (live, then offline). The one gated page not mapped; needs real
  HTML for a fixture, then a declared page, extractor and fingerprint.
- **E2.7 Re-record fingerprints** (live). `make fingerprints` after the session.

## E3. Contracts that can change

Cheap before the first publish, a migration for every user afterwards.

- **E3.1 Versioned state and config** (offline; done in #45). A schema version in
  `config.json`, the session store and the session history, with the migration path the
  session store already has. Done when an old file of each kind loads and a
  newer-than-known file fails with a user-facing error.
- **E3.2 Accounts keyed by school** (offline; done in #54). Config and state hold one
  school today; families have children in two schools or municipalities. Key persisted
  state by account even while every surface shows one. Done when two accounts can be
  stored side by side and existing single-account state migrates.
- **E3.3 Stability policy** (offline; done in #51). What counts as a breaking change to
  tool names, inputs, outputs, exit codes and settings, and how something is deprecated.
  One page in `docs/development/`, referenced from the release guide.
- **E3.4 Multi-account surfaces** (offline, after E3.2). Choosing the account in the
  CLI, MCP and connector. Scheduled only when someone needs it.

## E4. Typed domain model

Capabilities return the portal's raw JSON. An agent copes; a UI cannot, and drift in the
portal passes silently.

- **E4.1 Spec** (offline; done in #47). Types with stable ids and ISO dates in
  Europe/Stockholm: `Child`, `Lesson`, `CalendarEvent`, `LunchDay`, `Message`, and how an
  operation declares an output schema. The spec is
  [the typed domain model](docs/planning/specs/2026-09-26-typed-domain-model.md).
- **E4.2 First five operations** (offline; done in #47). `list_children`, `get_schedule`,
  `get_calendar`, `get_lunch_menu`, `get_messages`: output schema in the operation,
  mapping in the provider, tests against the existing fixtures. Done when each returns
  validated domain objects and MCP tools expose the output schema.
- **E4.3 Drift as an error** (offline; done in #47). A response that no longer parses
  becomes a specific user-facing error naming the operation, never bad data passed
  through.
- **E4.4 `doctor --verify`** (offline; done in #49). Reports which operations still parse
  against the live portal, sending and printing no data. The only early warning available,
  since live tests cannot run in CI. Its first real run belongs in the live session
  (`make verify-live`).
- **E4.5 Remaining operations** (offline). Assignments, news, contacts, files, bookings,
  subject rooms, activity log, then the gated ones. Each one typed also gets its CLI text
  view (E11.1); a boundary test requires one.
- **E4.6 Confirm mappings** (live, in E2's session if E4.2 lands first).

## E5. REST surface for custom UIs

Not a reverse proxy and not GraphQL: a third adapter generated from the operation
registry, inside the existing connector, behind the same OAuth grants and per-child
checks. Minimum first.

- **E5.1 Generated read routes** (offline, after E4.2; done in #48).
  `GET /api/v1/children/{id}/<operation>`, derived from the registry, run through
  `runOperation`, the child taken from the path and never from ambient focus. Read-only;
  errors map from the existing kinds to HTTP statuses with the existing message and hint.
  Done when the five typed operations are reachable, a grant without a child or scope is
  refused, and parallel requests for two children never cross. The routes cover the four
  typed operations the connector offers; `get_messages` gets a route only if the
  connector's consent grows to include it.
- **E5.2 `GET /api/v1/session`** (offline; done in #48). Logged in or not, which children
  the grant covers, whether the gated web login is present. Done when a UI can decide
  between showing data and linking to the owner dashboard.
- **E5.3 Reference page** (offline). One same-origin page served by the connector that
  renders a week for one child, as the smallest proof the surface is enough. In review in
  #57; the gaps it found are folded into E5.4 to E5.6, E6 and E11.5.
- **E5.4 OpenAPI and a typed client** (offline). Generated from the same Zod schemas.
  Scheduled now: the E11 app is the second consumer this waited for, and E11.4 builds on
  the client. The client owns token refresh, single-flight, because refresh tokens rotate
  with reuse detection and two parallel refreshes revoke the grant. The docs say that the
  OAuth resource is `<origin>/mcp` for REST too, or the protected-resource metadata is
  also served for `/api/v1`.
- **E5.5 Response metadata** (offline). `fetched_at`, cached or fresh, ETags. Today a UI
  cannot tell a cached week from a fresh one and has to send `fresh=true` to be sure.
- **E5.6 Composite overview** (offline). One operation per child for a dashboard's first
  paint: schedule, lunch, next event, unread messages, unreported absence. One week view
  is four requests today. Also closes two gaps from #57: the schedule week has no year
  (add `year` and the week's dates, or a date range as the calendar takes), and a child
  carries only a first name (add the school and class `list_children` already knows).
- **E5.7 Local serve mode** (offline). `serve` on 127.0.0.1 with a bearer token for a
  desktop UI; CORS allowlist for separately hosted pages.
- **E5.8 Login from a UI** (offline). Start a login and poll it, on the existing
  background login.
- **E5.9 Change notifications** (offline). Server-sent events fed by keepalive polling.

## E6. A good citizen towards the portal

Keepalive, the cache and any UI polling multiply traffic. If the unofficial client is
blocked, the project ends for everyone. Open from #57: every child switch is an upstream
cookie exchange and empties the read cache, so a UI that alternates children re-reads the
portal; the cache should survive switching back.

- **E6.1 One request budget** (offline; done in #52). A central limiter in front of the
  provider's transport across every surface: rate, concurrency, backoff on 429 and 5xx.
  Done when no code path reaches the portal around it and a test proves the ceiling.
- **E6.2 Circuit breaker** (offline; done in #52). Repeated push-back stops keepalive and
  cache refreshes and tells the user, instead of retrying.
- **E6.3 Drop `@elias4044/ssp-node`** (offline). Used only for HTTP helpers, student-only
  otherwise, and the reason writes had to disable redirects. Inline the small helper
  surface. Done when the dependency is gone and the README licence line is updated.

## E7. Write operations

`report_absence` (#21) carries a small gate of its own: `allowWrites` off by default,
preview unless confirmed, never repeated. That is enough for one write and the wrong
pattern for a second.

- **E7.1 Write framework spec** (offline). A `writes` declaration on operations,
  preview then confirm with a confirmation token, idempotency keys, an audit log holding
  no child data, and a separate OAuth write scope that an existing grant cannot gain by
  refresh.
- **E7.2 Framework and migration** (offline). Build it and move `report_absence` onto it.
- **E7.3 Leave application** (offline after E2.1, then live).
- **E7.4 Send message** (offline after E2.1, then live).
- **E7.5 Respond to bookings** (after E7.2).
- **E7.6 Writes on the connector and REST surface** (after E7.2). Off until the write
  scope exists; consent screen names writes separately from reads.

## E8. Session longevity, live half

Issue #8. The offline half (#22) records what it sees; the rest follows the numbers.

- **E8.1 Collect lifetimes** (live, passive). A few weeks of normal use with the session
  history on. Done when refresh-token and web-session lifetimes can be read from
  `auth_status`.
- **E8.2 Does the keepalive touch help** (live). Whether the header GET resets the web
  session's idle timer, and what an expired web session answers.
- **E8.3 One BankID, two sessions** (live). Whether one login can seed both the app and
  the web session.
- **E8.4 Tune defaults** (offline, after E8.1–E8.3). Keepalive intervals and cache TTLs
  from measurements; decide whether keepalive should be suggested in the parent guides.
- **E8.5 Deferred pieces** (offline). Encrypted cache for gated data, OS-level
  scheduling, cross-process protection for cold restore. Each only if E8.1 shows a need.

## E9. Connector hardening follow-ups

Left open by #20, listed in its description.

- **E9.1 Storage key rotation** (offline). Re-encrypt state under a new key with a
  documented procedure.
- **E9.2 Rollback protection** (offline). Restoring an old backup revives revoked grants;
  today the guide says to disconnect everything after a restore.
- **E9.3 Distributed exhaustion of pending consents** (offline). A flood from many
  networks can still displace a parent's pending request.
- **E9.4 Quiet provider diagnostics** (offline). The one stderr line per portal login.

## E10. Supportability

- **E10.1 Diagnostics bundle** (offline). One command producing a redacted report:
  versions, config shape, session ages, recent error kinds, `doctor --verify` results.
  No names, no content. Done when a parent can attach it to an issue without reading it
  first, and a test proves the redaction.
- **E10.2 Data-handling statement** (offline). What is stored, where, for how long, and
  what reaches the AI provider, in plain language, linked from the README.
- **E10.3 Claude Desktop extension directory listing** (owner).

## E11. User experience

What a parent looks at. Every surface is a thin client of the same core: none bypasses
the registry, `runOperation`, the read cache, the error contract or the per-child checks,
and all of them speak Swedish and English from the existing message keys. The terminal
stories need only the core; the app stories wait for the typed model (E4) and the REST
minimum (E5.1 to E5.3). Decision: React, React Native and React Native Web are one Expo
project in this repository, so the API and the app change together.

- **E11.1 CLI output for humans** ([#34](https://github.com/grimen/schoolsoft-agent/issues/34)) (offline; done in #50). The CLI is JSON-only today (`emit` in
  `src/cli/program.ts`, one global `--pretty`, no colours, no tables). Add `--format text`
  renderers per operation: lists as tables, a week view for schedule and calendar. JSON
  stays the default so agents and skills are unaffected; whether a terminal may default
  to text is settled by the stability policy (E3.3). Respect `SCHOOLSOFT_LANG`,
  `NO_COLOR` and a non-TTY stdout. Done when every read command has a text renderer with
  a snapshot test and JSON output is byte-identical to today. Views exist for the five
  typed operations; the other reads get one as E4.5 types them.
- **E11.2 Guided first run** ([#35](https://github.com/grimen/schoolsoft-agent/issues/35)) (offline). `schoolsoft-agent` without a config walks through
  school lookup (`configure` already prompts on a TTY through the injected `prompt`),
  login and a first schedule, in plain language. Done when a fresh machine reaches a
  schedule with no documentation open.
- **E11.3 TUI** ([#36](https://github.com/grimen/schoolsoft-agent/issues/36)) (offline). An interactive terminal view (Ink or equivalent) behind the
  CLI adapter, never in core: one tab per child, week schedule, lunch, messages, absence
  status, the login state and a "BankID needed" banner from `auth_status`, a refresh key
  that passes `fresh`. Done when it runs against the fake provider in tests and the
  artifact E2E drives it over a recorded session.
- **E11.4 App workspace** ([#37](https://github.com/grimen/schoolsoft-agent/issues/37)) (offline, after E4.2 and E5.1 to E5.3). `packages/app` as one
  Expo project with react-native-web, and `packages/client` as the typed client (E5.4).
  The repository is one package today, built with plain `tsc`; it becomes npm workspaces
  with the published `schoolsoft-agent` package unchanged in name and bins, the root keeps
  its coverage gate and boundary tests, and the app has its own test and lint job in CI.
  Done when `make app-web` serves a page that lists children from a running connector.
- **E11.5 Sign-in and consent in the app** ([#38](https://github.com/grimen/schoolsoft-agent/issues/38)) (offline; live to accept). The app is an OAuth
  client of the parent's own connector: connector address entry, discovery, PKCE, consent
  in the system browser, tokens in the platform keychain (on web, in memory plus refresh),
  session state from `/api/v1/session` (E5.2). Reuse the registration and keep the
  connection across tabs and restarts: today every new tab registers a new client and asks
  the owner for consent again, which a wall display or a phone cannot live with. Done when
  the flow test against the fake portal passes on web and the native flow is on the E2
  checklist.
- **E11.6 Core screens** ([#39](https://github.com/grimen/schoolsoft-agent/issues/39)) (offline). Today and week per child, lunch, messages, calendar,
  unreported absence, a child switcher, and an offline banner from the response metadata
  (E5.5) when present. Done when each screen renders from fixture data in component tests
  and against the connector in a web E2E.
- **E11.7 Native builds** ([#40](https://github.com/grimen/schoolsoft-agent/issues/40)) (owner, live). EAS builds for iOS and Android, TestFlight and
  internal testing; push notifications wait for E5.9. Done when a build installs on a
  phone and completes sign-in against a real connector.
- **E11.8 Absence report in the app** ([#41](https://github.com/grimen/schoolsoft-agent/issues/41)) (after E7.2 and E7.6). Preview, then confirm, over
  the write framework; never before the connector has a write scope.
- **E11.9 Accessibility and language** ([#42](https://github.com/grimen/schoolsoft-agent/issues/42)) (offline). VoiceOver and TalkBack labels,
  contrast, dynamic type, Swedish by default from the device locale. Done when an audit
  checklist is in `docs/` and CI runs an accessibility lint for the app.
- **E11.10 Web build served by the connector** ([#43](https://github.com/grimen/schoolsoft-agent/issues/43)) (offline). The connector serves the
  React Native Web bundle same-origin at `/app`, replacing the E5.3 reference page. The
  connector serves no static assets today and its policy is `default-src 'none'`
  (`src/http/server.ts`); the app routes get a scoped policy with hashed scripts and
  `connect-src 'self'`, the owner routes keep the strict one. Done when a deployed
  connector shows the app without CORS and the flow test asserts the owner policy is
  unchanged.

## Later

- A second school portal behind the provider seam, decorated on top of the current
  naming.
- ChatGPT local host support, when that host allows it.
- Evaluations: a fixed set of read-only questions per operation, scored per release.
- GraphQL, only if several independent UIs with different data needs appear; the typed
  model in E4 keeps that open.

## Suggested order

Done so far: E1.1, E2.1, E3.1 to E3.3, E4.1 to E4.4, E5.1, E5.2, E6.1, E6.2 and E11.1.
E5.3 is in review (#57), after the Referrer-Policy fix it surfaced (#58).

Next, in this order: E5.6 and then E5.4, since the reference page showed what a UI needs
before it is comfortable (a week with a year, one request per view, a client that
refreshes safely). E7.1 before any second write. E11.2 and E11.3, which need only the
core. E6.3, then E10.2.

The live E2 session should come soon rather than whenever a login happens to be
available. The Referrer-Policy bug locked every real browser out of the owner dashboard
while all offline tests passed, because they set `Origin` themselves; offline tests miss
what a real browser does. E2.1 and E4.4 are ready to make the one login count.

The app stories start with E11.4 once #57 has merged. The first published release (E1.6)
waits for the owner and does not block any of this.
