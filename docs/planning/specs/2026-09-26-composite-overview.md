---
title: Composite overview, one request per child for a dashboard's first paint
type: feature
created: 2026-09-26
status: in-review
route: dispatch
baseline_commit: 7085696
context:
  - AGENTS.md
  - docs/development/architecture.md
  - docs/development/stability.md
  - docs/planning/specs/2026-09-26-rest-surface.md
  - docs/planning/specs/2026-09-26-request-budget.md
  - docs/planning/specs/2026-09-26-typed-domain-model.md
  - https://github.com/grimen/schoolsoft-agent/issues/28
---

# Composite overview: one request per child for a dashboard's first paint (E5.6)

The reference page (E5.3, PR #57) showed what a week view costs over the REST surface: a session read plus three reads per child and week, a Monday the UI has to compute itself from a week number without a year, and a child switch upstream every time the UI alternates children. This story adds one route that answers a dashboard's first paint for one child in one request, with an unambiguous week, and makes the schedule's own answer carry its dates. Built offline: no SchoolSoft login, no BankID round and no request to schoolsoft.se took place.

<frozen-after-approval>

## Intent

`GET /api/v1/children/{childId}/overview` returns, for one child the grant covers, the week's lessons, the week's lunch and the next school event, each as its own section that either carries the same validated domain object the single route returns, says the connection was not granted it, or carries the problem that stopped it. One section failing never fails the others. The week is named by ISO dates in Europe/Stockholm. It is a composite of the existing typed operations inside the connector, run in one turn of the runtime's queue, not a new operation and not a new scope.

## Scope

In: the overview route, the week model, `year`, `startDate` and `endDate` on `get_schedule`'s output, the current week computed in Stockholm, the REST reference, the connector guide, the architecture page, tests.

Out: unread messages and unreported absence (see "Sections left out"), response metadata such as `fetched_at` (E5.5), a cache that survives a child switch (E6), an MCP tool or CLI command for the overview, CORS (E5.7).

## The week model

**The problem.** SchoolSoft's timetable endpoint takes a week number and nothing else. `get_schedule` passes that on and answers `{ week }`. `get_lunch_menu` picks the ISO week-year whose week starts nearest today (`lunchYear`) and answers `{ year, week }` with dated days. `get_calendar` takes dates. A UI has to compute a Monday from a week number and hope the connector's clock agrees with its own. The default "current week" is also computed from the server's local date (`isoWeek()` uses `getFullYear`/`getDate`), so a connector running in UTC answers last week between midnight and 01:00 or 02:00 Stockholm time on a Monday.

**The model.** One vendor-neutral helper in core, `weekOf` (`src/core/operations/_week.ts`), used by both operations and the overview:

- A week is `{ year, week, startDate, endDate }`: the ISO week-year, the ISO week number, and its Monday and Sunday as `YYYY-MM-DD` in Europe/Stockholm.
- Given a week number, the year is the ISO week-year in which that week starts nearest today in Stockholm, exactly `lunchYear`'s rule today. A week number that no neighbouring year has (week 53 when neither last, this nor next year has one) is an input error, as it already is for the lunch menu.
- Given a date, the week is the ISO week containing it. Because the portal is only told the week number, the date must name a week that the rule above maps back to the same year: a week within about half a year of today. Anything further is refused with `400` rather than answered for the wrong year.
- "Today" and the default week come from Stockholm's calendar (`stockholmToday`), not the server's zone.

**`get_schedule` gains `year`, `startDate` and `endDate`.** They are new, non-null fields of a typed output: compatible under the stability policy ("a new field"). `week` keeps its meaning and position. The MCP `outputSchema`, the generated references and the CLI text view follow. `get_lunch_menu` keeps its shape and now shares the helper. The shared `isoWeek()` default is replaced by the Stockholm week for both operations; that is a correction of the default, not a change of what it means ("the current week").

**The one behaviour change, and why it is a fix.** `get_schedule` with a week number that does not exist near today (from 2028, week 53) was passed to the portal; it is now refused with the lunch menu's input error (`400` on REST, exit 6 in the CLI). Such a week has no Monday, so no correct `startDate` exists. The input is described as an ISO week; a week the ISO calendar does not have was never a valid value, and the lunch menu has refused it since E4.2. The first year it can occur is 2028.

## The overview route

`GET /api/v1/children/{childId}/overview`, query parameters:

| Parameter | Type | Meaning |
| --- | --- | --- |
| `date` | string, `YYYY-MM-DD` | Any day of the week to show. Default: today in Europe/Stockholm. |
| `fresh` | boolean | Passed to every section's operation: skip the read cache. |

Unknown or repeated parameters, a malformed or impossible date, or a date whose week is too far from today: `400` `invalid-input`, before any upstream request.

**Response** (`application/json`, validated against its Zod schema before it is sent):

```json
{
  "child": { "id": 201, "firstName": "Alva", "schoolName": "Rösjöskolan", "className": "4B" },
  "week": {
    "year": 2026,
    "week": 39,
    "startDate": "2026-09-21",
    "endDate": "2026-09-27",
    "today": "2026-09-26",
    "timezone": "Europe/Stockholm"
  },
  "schedule": { "status": "ok", "data": { "year": 2026, "week": 39, "startDate": "…", "endDate": "…", "child": {}, "lessons": [] } },
  "lunch": { "status": "error", "problem": { "type": "urn:schoolsoft-agent:problem:upstream", "status": 502, "…": "…" } },
  "nextEvent": { "status": "not-granted", "scope": "get_calendar" }
}
```

- `child` is the domain `Child` (`list_children`'s item): first name, school and class. The connector's `/children` projects school and class away for AI apps; a dashboard that shows two children with the same first name needs them, and the parent approved this child for this app. It is still only the child in the path.
- `week` is the week model above plus `today` (the date the default and `nextEvent` are computed from) and the timezone.
- Each section is a discriminated union on `status`:
  - `ok`: `data` is the section's validated object.
  - `not-granted`: the token lacks `scope`; nothing was read for it.
  - `error`: `problem` is the problem details body the single route would have answered (`type`, `title`, `status`, `detail`, `hint`, `kind`, `retryable`, `retryAt` when the portal pushes back), in the negotiated language.
- Sections are objects, so response metadata (E5.5: `fetchedAt`, cached or fresh) can be added per section without breaking v1.

| Section | Operation and scope | `data` |
| --- | --- | --- |
| `schedule` | `get_schedule` with the week's number | `get_schedule`'s output, unchanged |
| `lunch` | `get_lunch_menu` with the week's number | `get_lunch_menu`'s output, unchanged |
| `nextEvent` | `get_calendar` from `today` to `today` + 29 days | `{ event, from, until }`: the first entry of `kind: "event"` that has not ended (a date-only end on or after today, a date-time end after now), ordered by start; `null` when there is none |

The schedule and lunch sections carry `year`, `week`, `startDate` and `endDate` of their own, equal to `week`'s; a UI can check them. `nextEvent` is anchored at today, not at the week shown: it answers "what is coming up", which is what a first paint needs. The window is fixed and documented; a UI that wants a whole month uses `/calendar`.

**Which failures stay in a section.** A section keeps its failure when it concerns that read: `response-drift`, `upstream`, `network`, `portal-pushback`, `not-implemented`, `not-available`, `web-session` and `internal` (a bug in one section should not blank the dashboard; its problem body carries no detail). Everything that concerns the request as a whole fails the whole response with the single routes' status, and no section is released: the token or grant (`401` `oauth-token`, including a grant revoked mid-request), the child (`403` `child-not-permitted`), the connector's SchoolSoft session (`409` `schoolsoft-session`, since no section can succeed without it), the runtime (`503` `connector-busy`, including the child's focus moving), a cancelled request, and invalid input.

**Scopes.** The overview has no scope of its own and widens no consent: each section needs its operation's scope, exactly as its single route does, and a missing one is `not-granted`. A token with none of the three scopes gets `403` `scope-not-granted` naming all three (`WWW-Authenticate: Bearer error="insufficient_scope", scope="get_schedule get_lunch_menu get_calendar"`), before anything runs. `GET /api/v1/session`'s `routes` is unchanged: it lists operation routes, and the overview is available whenever one of its sections' routes is listed.

## Request budget, cache and child focus

- **One turn of the queue.** The runtime runs the whole overview as one serialized step (`ConnectorRuntime.executeForChild`): one grant check, one session restore, at most one child switch, then the sections. No other request, for this or another child, can switch the focus between two sections, so the cookie exchange and the cache flush a switch causes happen at most once per overview instead of once per section when a UI alternates children.
- **Sequential sections.** Sections run one after the other. After the portal pushes back on one, the request budget holds or refuses the rest without sending them (the section says `portal-pushback`), where parallel sections would already be in flight. A cold overview costs at most one child switch plus one schedule, one lunch and two calendar requests (five), inside the default burst of ten; a warm one costs nothing, because every section goes through `runOperation` and the read cache, keyed by child and arguments like the single routes (the overview's calendar range is its own cache entry).
- **Same guards.** Each section is the runtime's ordinary read: consent and focus rechecked before every upstream request and cache hit (`beforeRead`), after recovery, and after the result, the request's `AbortSignal` passed to the budget, and the grant re-verified after the last section before anything is sent.
- **Rate limit.** An overview is one request against the caller's 60 per minute, where the reference page's week view is four.

## Sections left out

**Unread messages.** `get_messages` is typed, but the connector does not offer it, so no grant can include it, and the inbox is the guardian's, not the child's: its `child_id` only selects the school. Serving it here would show one child's app messages about another child, which per-child consent cannot express. Offering it is a consent decision of its own (the REST surface spec says the same). When it is offered, `unreadMessages` joins as a new section: a new field, compatible.

**Unreported absence.** It needs SchoolSoft's gated web login and the headless browser, which the connector does not have (`browser: null`, `webSession` always false), and its output is untyped raw page structure (E4.5). A section that can only ever say "not offered" would still fix a data shape in v1 that the typing work must then keep. It joins, compatibly, when it is typed and a host that can serve it (the local serve mode, E5.7) exists.

## I/O and edge cases

| Input or condition | Required behaviour |
| --- | --- |
| No query | The week containing today in Stockholm; `nextEvent` from today |
| `date=2026-09-26` (a Saturday) | Week 39 of 2026: `startDate` 2026-09-21, `endDate` 2026-09-27 |
| `date=2026-02-30`, `date=26-09-26`, `date` given twice, `week=39` | 400 `invalid-input`, no upstream request |
| A date more than about half a year from today | 400 `invalid-input` saying the week is too far from today |
| Token without the child | 403 `child-not-permitted`, no upstream request |
| Token with none of the three scopes | 403 `scope-not-granted`, no upstream request |
| Token without `get_lunch_menu` | `lunch` is `not-granted`, no lunch request; the others are read |
| Lunch answer drifts or fails | `lunch` carries `response-drift` or `upstream`; `schedule` and `nextEvent` are `ok`; status 200 |
| Portal pushes back on the first section | That section carries `portal-pushback`; the rest are refused by the budget without a request |
| Grant revoked during a section | 401 `oauth-token`; no section released |
| SchoolSoft session rejected and silent re-login fails | 409 `schoolsoft-session` for the whole response |
| Overviews for two children in parallel | Each answer's sections are read under its own child's focus, never the other's |
| Same overview twice | The second makes no upstream request (read cache); `fresh=true` reads every section again |
| `get_schedule?week=53` when no neighbouring year has week 53 | 400 (was: passed to the portal) |

</frozen-after-approval>

## Code Map

- `src/core/operations/_week.ts`: the week model (`weekOf`, `weekOfDate`), exported through `core/index.ts`.
- `src/core/operations/get-schedule.ts`, `get-lunch-menu.ts`: the shared week helper; `get_schedule`'s new fields.
- `src/http/runtime.ts`: `executeForChild`, the queue step shared with `execute`.
- `src/http/overview.ts`: sections, schemas, the week and next-event logic, which failures stay in a section.
- `src/http/rest.ts`: the route; `src/http/routes.ts`: the reserved slug and the query parser shared with it.
- `scripts/gen-docs.ts` → `docs/reference/rest-api.md`, `tools.md`, `commands.md`.
- `test/unit/week.test.ts`, `test/unit/http-overview.test.ts`, `test/functional/http-overview.test.ts` (on the REST fixture, now shared as `test/helpers/rest-connector.ts`), `test/packaging/connector-smoke/flow.mjs` (one overview), updates to the typed-output and runtime tests.

## Tasks & Acceptance

- [x] Given a grant for a child, when a UI calls the overview, then it gets the week's schedule and lunch and the next event, each validated, with the week named by Stockholm dates.
- [x] Given a grant without the child or without any section's scope, then the overview is refused before any upstream request; without one section's scope, that section is `not-granted`.
- [x] Given one section's read failing, then only that section carries the problem.
- [x] Given two children requested in parallel, then no section carries the other child's data.
- [x] Given a cold and a warm overview, then the upstream requests stay within the request budget and the warm one sends none.
- [ ] Live acceptance: a dashboard on a parent's deployment against a real SchoolSoft session.

## Verification

See the pull request for the gate results.
