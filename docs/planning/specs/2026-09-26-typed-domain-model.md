---
title: Typed domain model, first five operations
type: feature
created: 2026-09-26
status: in-review
route: dispatch
baseline_commit: 221f285ec6266e44f7797c9f946cef491da6e64d
context:
  - AGENTS.md
  - docs/development/architecture.md
  - docs/reference/schoolsoft-api.md
  - https://github.com/grimen/schoolsoft-agent/issues/27
---

# Typed domain model: first five operations (E4.1–E4.3)

Capabilities have so far returned SchoolSoft's JSON as it came. An agent copes with that; an app or a REST client cannot, and when SchoolSoft renames a field the change passes through silently. This spec gives five operations stable, validated, vendor-neutral outputs and turns an answer that no longer fits into a specific error. Built offline: no SchoolSoft login, no BankID round and no request to schoolsoft.se took place.

<frozen-after-approval>

## Intent

`list_children`, `get_schedule`, `get_calendar`, `get_lunch_menu` and `get_messages` return domain objects with stable ids and ISO-8601 dates and times in Europe/Stockholm. Every result is checked against a declared output schema before it leaves core. When the portal answers in a shape the provider cannot map, the user gets one error that names the operation and says that nothing was returned, never data that may be wrong.

## Scope

In: the domain types below, `output` on `defineOperation`, validation in `runOperation`, provider-side mapping for the five operations (and the guardian profile they depend on), the drift error, MCP `outputSchema` and structured content, generated reference docs.

Out: the other operations (E4.5), `doctor --verify` (E4.4), a REST surface (E5), the parent-hosted connector's MCP `outputSchema` (its tools keep answering with text; its results do change shape, see below), renaming the `schoolsoft_` tool prefix or numeric `child_id` input.

## Domain types

All live in `src/core/domain/` as Zod schemas with inferred TypeScript types. Nothing in them names SchoolSoft.

| Type | Fields |
| --- | --- |
| `LocalDate` | `YYYY-MM-DD`, a calendar date in Europe/Stockholm |
| `DateTime` | ISO-8601 with seconds and the UTC offset Europe/Stockholm had at that instant, e.g. `2026-09-07T08:30:00+02:00` |
| `ChildRef` | `id` (number), `firstName` |
| `Child` | `id`, `firstName`, `schoolName` (string or null), `className` (string or null) |
| `Lesson` | `id` (string), `title`, `start`, `end` (`DateTime`), `room`, `group`, `teacher`, `note` (string or null) |
| `CalendarEvent` | `id` (string), `kind` (`lesson` or `event`), `title`, `allDay`, `start`, `end` (`LocalDate` when the source gave a date, else `DateTime`), `location`, `teacher`, `group`, `category`, `note` (string or null) |
| `LunchDay` | `date` (`LocalDate`), `weekday` (1 = Monday … 7 = Sunday), `dishes: [{ kind, description }]` |
| `Message` | `id` (number), `subject`, `preview`, `read`, `sender` (`{ name }` or null), `sentAt` (`DateTime`), `hasAttachments` |

**Ids.** An id that a tool accepts as input keeps that input's type: `Child.id` is what `child_id` takes and `Message.id` is what `get_message` takes, both numbers. Ids that only identify (lessons, calendar events) are opaque strings, deterministic for the same upstream item, so a later call produces the same id. The SchoolSoft provider builds them from the event id and the start (`lesson:<eventId>@<start>`, `event:<eventId>@<start>`), because a recurring event id alone is not known to be unique per occurrence.

**Times.** SchoolSoft gives local wall-clock strings. The provider attaches the offset Stockholm had at that local time (`stockholmDateTime` in `core/domain/time.ts`), so a consumer cannot mistake it for UTC. Date-only values stay dates. An upstream value that already carries an offset or `Z` is converted to the Stockholm offset for the same instant.

## Operation outputs

| Operation | Output |
| --- | --- |
| `list_children` | `{ guardianName, children: Child[], childInFocus }` |
| `get_schedule` | `{ week, child: ChildRef, lessons: Lesson[] }` |
| `get_calendar` | `{ startDate, endDate, timezone: "Europe/Stockholm", child: ChildRef, events: CalendarEvent[] }` |
| `get_lunch_menu` | `{ year, week, child: ChildRef, days: LunchDay[] }` |
| `get_messages` | `{ messages: Message[] }` |

`get_lunch_menu` now needs a year to date each day. The operation picks the ISO week-year whose week of that number starts nearest today (Stockholm), so "week 2" asked in December means next January. The provider receives it as a third argument to `getLunchWeek`; SchoolSoft's URL does not use it.

**Breaking change, on purpose.** The CLI JSON and the MCP structured content of these five operations change from SchoolSoft's field names (`studentId`, `startDate`, `dayId`, `isRead`, `menu`, `entries`, `source: "lessons"`) to the shapes above. Unknown upstream fields are no longer passed on. Nothing has been published, so there are no users to migrate; the change is announced in the pull request and in the generated references. The parent-hosted connector returns the same shapes for `get_schedule` and `get_lunch_menu`, and its `list_children` projection becomes `{ children: [{ id, firstName }], childInFocus }` so ids match everywhere.

## How an operation declares its output

`Operation` gains an optional `output`, a Zod object schema next to `input`. `defineOperation` infers the result type from it, so `run` must return that shape to compile. `runOperation` (the one way every surface runs an operation) validates the result with `output.safeParse` and returns the parsed value, which drops any undeclared keys. A result that fails is a `response_drift` error naming the operation. Operations without `output` are returned as before.

## Where mapping happens

In the provider. `src/providers/schoolsoft/portal/domain/` holds one module per upstream shape (`parent.ts`, `lessons.ts`, `agenda.ts`, `lunch.ts`, `inbox.ts`) with a Zod schema of the raw JSON and a function to the domain type. The API backends (`EvaApi`, `WebviewApi`) call them, so the `Portal` methods return domain types (`Lesson[]`, `CalendarEvent[]`, `LunchDay[]`, `Message[]`) and `getParent` returns a validated `GuardianParent` stripped of fields core never uses (pictures, GUIDs, usernames no longer reach the saved session). Core never sees these raw shapes.

**Mapping before the cache.** The cache decorator wraps the portal, so it stores what the provider returns: already mapped, already validated domain objects. A drifted answer throws before it could be stored, so the cache can never serve an unvalidated value, and the cached entries are smaller. Output validation in `runOperation` sits above the cache and runs on hits too; it is cheap and catches anything that reaches an operation by another path. Key, TTLs, scope checks, `fresh` and invalidation are unchanged.

## Drift is an error

`ResponseDriftError` (core, `errors/index.ts`) carries the operation or capability and a detail made only of field paths and Zod issue codes (`0.startDate invalid_format`), never values, so a message or a log line cannot leak a child's data. The provider throws it with the capability; `runOperation` re-throws it naming the operation.

Message `response_drift` (English and Swedish): the portal's answer for the operation has changed shape, nothing was returned. Hint `update_or_report`: update schoolsoft-agent, and if the newest version fails too, run `doctor` and report the operation named.

**Kind `upstream`, exit code 7, not retryable.** The cause is the portal's answer, which is what `upstream` means; retrying returns the same shape, so `retryable` is false. It is not `internal` (exit 1, "a bug in this program"): the program is doing what it should by refusing. It is not a new kind: a skill branches on "the portal is the problem", and the message key distinguishes drift from an HTTP failure. `isTransient` stays false for it, but a drift error never clears a saved session (`keepsSession`): the credentials are fine, and throwing them away would cost the user a BankID round for our parser's problem.

## Surfaces

- **MCP (stdio).** SDK 1.30.0 supports `outputSchema` on `registerTool` (Zod object, converted to JSON Schema in `tools/list`); its server validates `structuredContent` against it, and so does its client. The five tools declare it. Every typed result carries `structuredContent`, also when the text copy is truncated at 25 000 characters, because the protocol requires structured content from a tool that declares an output schema. Error results of typed tools carry the two text lines only: the SDK client validates `structuredContent` against the output schema even when `isError` is set, so the usual `{ error: { kind, retryable } }` object would turn a clean tool error into a protocol failure. Untyped tools keep it. A drift error is therefore an ordinary tool error result, never a protocol failure.
- **CLI.** JSON on stdout in the new shapes; drift prints two lines on stderr and exits 7.
- **Connector.** Unchanged security behaviour: consent and child focus are checked before the cache and every GET. Drift surfaces as its generic "access is unavailable" error result.
- **Docs.** `make docs` renders an "Output" table per typed tool and command from the schema; `make skills` copies it into the skill.

## Field provenance

"Name verified" means the field name appears in the response shapes recorded live on 2026-09-06 (`docs/reference/schoolsoft-api.md`). No live JSON is committed, so every value format and type is inferred from those notes and synthetic fixtures: **assumed, verify in the live pass (E2/E4.6)**. The test fixtures in `test/fixtures/json/` are synthetic, built to the recorded shapes.

| Domain field | Raw source | Status |
| --- | --- | --- |
| `Child.id` | parent `children[].studentId` | name verified; integer assumed |
| `Child.firstName` | `children[].firstName` | name verified; string assumed |
| `Child.schoolName` | `children[].schools[0].name` | name verified; string assumed |
| `Child.className` | `children[].schools[0].className` | name verified; string or null assumed |
| `guardianName` | parent `firstName` + `lastName` | names verified |
| (routing) | parent `userId`, `children[].schools[].orgId` | names verified; integers assumed |
| `Lesson.id` | lessons/week `eventId` + `startDate` | names verified; number or string assumed; uniqueness per occurrence assumed |
| `Lesson.title` | `name` | name verified |
| `Lesson.start`, `end` | `startDate`, `endDate` | names verified; local `YYYY-MM-DDTHH:MM[:SS]` assumed |
| `Lesson.room`, `group`, `teacher`, `note` | `room`, `teachingGroup`, `teacher`, `description` | names verified; string, null or absent assumed |
| `CalendarEvent.*` | agenda `eventId`, `name`, `startDate`, `endDate`, `allDay`, `room`, `teacher`, `teachingGroup`, `category`, `description` | assumed: taken from the upstream skolplattformen adapter and synthetic fixtures, not observed live |
| `LunchDay.date` | requested week, `dayId` + the resolved year (the raw `week` is type-checked, not used) | names verified; Mon=1…Fri=5 verified; which year SchoolSoft means assumed |
| `LunchDay.weekday` | `dayId` | verified (1–5); 6–7 assumed |
| `LunchDay.dishes[].kind`, `description` | `dishes[].mealType`, `dishes[].description` | names verified; string (or number for `mealType`) assumed |
| `Message.id` | inbox `id` | name verified; integer assumed |
| `Message.subject`, `preview` | `subject`, `message` | names verified; strings assumed |
| `Message.read` | `isRead` | name verified; boolean assumed |
| `Message.sender.name` | `sender.firstName` + `sender.lastName` | names verified; nullable sender assumed |
| `Message.sentAt` | `date` | name verified; format assumed (local ISO with `T` or a space, optional seconds, optional offset, or epoch milliseconds accepted) |
| `Message.hasAttachments` | `hasFiles` | name verified; boolean assumed |

## I/O and edge cases

| Input or condition | Required behaviour |
| --- | --- |
| Upstream renames, drops or retypes a required field | `response_drift` naming the operation; nothing returned, nothing cached, session kept. An older good entry for the same key stays cached until its TTL |
| Upstream adds a field | Ignored |
| Optional text field empty, null or absent | `null` |
| Guardian profile drifts during login or restore | `response_drift` naming the operation that triggered it (`login`, or the read that restored the session); saved session kept |
| Result fails the operation's own `output` schema | `response_drift` naming the operation |
| Local time in the autumn DST fold | The earlier (summer-time, `+02:00`) instant; stable across calls |
| Local time in the spring DST gap | The offset from before the change (`+01:00`); stable across calls |
| Timestamp with an offset or `Z` | Converted to the Stockholm offset of the same instant |
| `get_lunch_menu` week 53 in a year without one | `input` error |
| MCP text longer than 25 000 characters | Text truncated, structured content complete |

</frozen-after-approval>

## Code Map

- `src/core/domain/`: schemas and types (`schemas.ts`), Stockholm time and ISO-week helpers (`time.ts`).
- `src/core/operations/types.ts`, `run.ts`: `output`, validation, drift naming.
- `src/core/operations/{list-children,get-schedule,get-calendar,get-lunch-menu,get-messages}.ts`: output schemas.
- `src/core/errors/`: `ResponseDriftError`, `keepsSession`, `response_drift`, `update_or_report`.
- `src/core/portal/types.ts`: domain return types; `session/session-manager.ts`: drift keeps the session.
- `src/providers/schoolsoft/portal/domain/`: raw schemas and mappers; `api/eva-api.ts`, `api/webview-api.ts` call them.
- `src/mcp/server.ts`, `respond.ts`: `outputSchema`, structured content always for typed tools.
- `src/http/runtime.ts`: `list_children` projection, lunch year.
- `scripts/gen-docs.ts`: output tables; the exit-code line now lists all codes.
- `test/fixtures/json/`, `test/helpers/portal-json.ts`: live-shaped synthetic answers and their drifted variants.
- `AGENTS.md`, `docs/development/architecture.md`, `docs/reference/schoolsoft-api.md`, `skills/schoolsoft/SKILL.md`: the rule, the design, the calendar mapping, what an agent does on drift.

## Tasks & Acceptance

- [x] E4.1 Spec (this file).
- [x] E4.2 Given each of the five operations, when it runs against live-shaped synthetic fixtures, then it returns the domain shape and MCP `tools/list` shows its `outputSchema`.
- [x] E4.3 Given a fixture with a renamed, a missing and a wrong-typed field for each of the five, when the operation runs, then MCP returns an error result, the CLI exits 7 with two lines, and the connector refuses; no data is returned or cached and the session survives.
- [x] Registry: every operation that declares `output` is validated by `runOperation`.
- [ ] Live pass (E4.6): confirm every "assumed" row above.

## Verification

See the pull request for the gate results.
