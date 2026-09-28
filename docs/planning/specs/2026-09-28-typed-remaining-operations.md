---
title: Typed domain model, remaining operations
type: feature
created: 2026-09-28
status: in-review
route: dispatch
baseline_commit: 00c97035
context:
  - AGENTS.md
  - docs/planning/specs/2026-09-26-typed-domain-model.md
  - docs/planning/specs/2026-09-26-doctor-verify.md
  - docs/planning/specs/2026-09-26-cli-text-output.md
  - docs/development/stability.md
  - docs/reference/schoolsoft-api.md
  - https://github.com/grimen/schoolsoft-agent/issues/27
---

# Typed domain model: remaining operations (E4.5)

Five operations return validated domain objects since E4.2
([spec](2026-09-26-typed-domain-model.md)). The other reads still hand on
SchoolSoft's JSON, or the raw text a browser extractor lifted off a page. This
spec types the rest on the same rules: stable ids, ISO dates in
Europe/Stockholm, mapping in the provider, drift as one error, a `doctor
--verify` entry and a `--format text` view for each. Built offline: no
SchoolSoft login, no BankID round and no request to schoolsoft.se took place.

<frozen-after-approval>

## Intent

Every read an agent, a script or an app is likely to call answers in a shape
that is documented, validated and the same whichever school portal served it.
Where the recorded evidence does not show a field's real shape, only what it
does show is typed, the rest is listed below for the live pass (E4.6), and an
operation with nothing recorded stays untyped rather than guessed.

## Scope and delivery

Three groups, each its own pull request, each on the rules of the E4.1 spec
(unchanged: `output` on the operation, mapping in
`src/providers/schoolsoft/portal/domain/`, `runOperation` validates, drift is
`response_drift`, kind `upstream`, exit 7, never cached, session kept).

| Group | Operations | Served by | Pull request |
| --- | --- | --- | --- |
| A | `get_assignments`, `get_news`, `get_subject_rooms` (API); `get_bookings`, `get_files` (browser, app session) | webview REST, Eva, JSP pages | first |
| B | `get_grades`, `get_student_documents`, `get_unreported_absence`, `get_attendance_report`, `get_assessment_criteria` | browser, web session (GDPR gate) | second |
| Held back | `get_contacts`, `get_message`, `get_activity_log` | | after #74 merges |
| Not typed yet | `get_assignment_detail`, `get_grade_prognosis` | | after E4.6 records their fields |

Out: new capabilities, new REST routes (see "Surfaces"), the connector's MCP
`outputSchema`, renaming tool names or inputs.

## Common rules added by this spec

- **Ids.** As in E4.1: an id a tool takes as input keeps that input's type
  (`Assignment.id` is what `get_assignment_detail` takes, a number). Every
  other id is an opaque, deterministic string with a kind prefix. When the
  portal gives an id it is used (`news:<id>`, `subject-room:<activityId>`);
  when it gives none (the browser pages) the id is derived from what
  identifies the entry on the page, hashed so the id does not repeat its text
  (`booking:<start>#<hash of title>`, `file:<hash of url>`; FNV-1a, 32 bits,
  hex). The same upstream entry gives the same id on every call.
- **Labels.** A status or category the portal words itself (and whose type
  was not recorded) is accepted as a string or a number and returned as
  text, trimmed; empty, null or absent is `null`. Same rule as `Dish.kind`.
- **Timestamps** accept what E4.1's `Message.sentAt` accepts: a local
  wall-clock `YYYY-MM-DD[T ]HH:MM[:SS]`, one with an offset or `Z`, or epoch
  milliseconds; the result is a Stockholm `DateTime`. A value documented as a
  date may also be a plain `YYYY-MM-DD` and then stays a `LocalDate`.
- **Browser pages.** The in-page extractor lifts text only (it runs inside
  Chromium and is outside the unit-coverage gate); the provider's domain
  module parses that text with a Zod schema, so status words, dates and link
  kinds are decided in tested Node code. A page whose text no longer parses
  (a date in another format, an entry without a title) is drift. A page whose
  anchors are gone is still `browser verify`'s job; it returns no entries
  rather than wrong ones.

## Group A: domain types

In `src/core/domain/schemas.ts`, nothing in them names SchoolSoft.

| Type | Fields |
| --- | --- |
| `Assignment` | `id` (number, pass to `get_assignment_detail`), `title`, `subtitle` (text or null), `subjectRoomId` (string, the `SubjectRoom.id` it belongs to), `date` (`LocalDate` or `DateTime`, the date the portal lists it under), `read` (boolean), `submissionStatus`, `resultStatus` (label or null) |
| `NewsItem` | `id` (string), `title`, `body` (text or null), `category`, `author` (text or null), `read`, `hasAttachments` (boolean), `publishedAt` (`DateTime`), `visibleUntil` (`LocalDate`, `DateTime` or null) |
| `SubjectRoom` | `id` (string), `name`, `groups` (string[]), `teachers: [{ name, role }]` (`role` label or null) |
| `Booking` | `id` (string), `title`, `description` (text or null), `start` (`DateTime`, or `LocalDate` when the page gives a date only), `end` (`DateTime` or null), `status` (`available`, `booked`, `closed` or `unknown`), `details: [{ label, value }]` (as the page words them, in page order) |
| `SharedFile` | `id` (string), `name`, `url` (as the page links it), `kind` (`file` or `link`), `category` (text or null) |

## Group A: operation outputs

| Operation | Output | Was |
| --- | --- | --- |
| `get_assignments` | `{ week, year, child: ChildRef, assignments: Assignment[] }` | `child: { studentId, firstName }`, raw `[{ id, activityId, title, subTitle, sortDate, … }]` |
| `get_news` | `{ child: ChildRef, news: NewsItem[] }` (at most `limit`) | raw `[{ id, title, description, creDate, toDate, … }]` |
| `get_subject_rooms` | `{ child: ChildRef, rooms: SubjectRoom[] }` | `subjects: [{ subject, subjectId, groups, teachers: string[] }]` |
| `get_bookings` | `{ child: ChildRef, bookings: Booking[] }` | `[{ title, description?, slots: [{ start, status }], info? }]`, `start` the page's text |
| `get_files` | `{ child: ChildRef, files: SharedFile[] }` | `[{ name, url, type, category? }]` |

A booking on the page is one accordion entry with one time, so `Booking`
carries `start` and `end` directly; the old one-element `slots` array goes.
Status is read from the entry's label/value pairs as before: a value
containing `bokad`/`booked` is `booked`, `stängd`/`closed`/`passerad` is
`closed`, `ledig`/`open`/`tillgänglig` is `available`, anything else
`unknown`. A file link is `file` when it points at `file_download.jsp` or ends
in a document extension (`pdf`, `doc(x)`, `xls(x)`, `ppt(x)`), else `link`.
Both rules are unchanged, only moved from the extractor into the provider.

The booking time text is parsed as `YYYY-MM-DD HH:MM`, optionally followed by
` - HH:MM` (the end, same day), or as `YYYY-MM-DD` alone (a date). Any other
text is drift.

## Group B: the gated pages (second pull request)

The gated pages are read with the generic table extractor and have thin
fixtures: one observed empty grades page, one empty unreported-absence page
with its message, one attendance summary, one criteria matrix, one document
list. What they prove is a table, not a domain, except for the documents list
whose three columns are fixed. So:

| Type | Fields |
| --- | --- |
| `TablePage` | `title`, `message` (text or null), `sections: [{ heading (text or null), headers: string[], rows: [{ cells: string[], link (string or null) }] }]` |
| `StudentDocument` | `id` (string, `document:<requestid>`), `title`, `createdBy` (text or null), `date` (`LocalDate`), `archived` (boolean), `link` (string) |

| Operation | Output |
| --- | --- |
| `get_grades` | `{ child: ChildRef, page: TablePage }` |
| `get_unreported_absence` | `{ child: ChildRef, page: TablePage }` |
| `get_attendance_report` | `{ child: ChildRef, page: TablePage }` |
| `get_assessment_criteria` | `{ child: ChildRef, subject, page: TablePage }` |
| `get_student_documents` | `{ child: ChildRef, documents: StudentDocument[] }` |

`TablePage` is typed as a table on purpose: the cell meanings (which column is
a grade, which a reason) are not recorded for these pages, and guessing them
would turn a school's own wording into drift errors. E4.6 records them; a
later, additive change can add typed rows next to `page`.

## Held back until #74 merges

Open pull request #74 adds a redaction boundary for other families' data
(`src/core/portal/third-party.ts`), a portal decorator applied below the read
cache around exactly these three capabilities. Typing them now would
conflict with it, and a mapper placed on the wrong side of the decorator
could hand on what it removes. After #74 merges, each is typed with the
redaction as a fixed input, never re-derived:

| Operation | Planned output | What the typed shape must preserve |
| --- | --- | --- |
| `get_contacts` | `{ child: ChildRef, groups: [{ title, staff (boolean), people: [{ name, role, email, phone }] }] }` | `email` and `phone` are `null` for other families by default; only the explicit `contactDetails` opt-in may fill them, and only for guardians, never a pupil. The mapper sits above the decorator (it maps what the decorator already reduced) and has no field the decorator does not pass. |
| `get_message` | `{ message: Message & { body, recipients: [{ name }], attachments: [{ name }] } }` | Recipients are display names only; no key that holds contact details at any depth. The schema has no field for them, so a future upstream field cannot pass. |
| `get_activity_log` | `{ child: ChildRef, entries: [{ id, date (DateTime), title, author, text, summary, images, recipients, comments }] }` | Only the known entry fields pass; the schema matches the decorator's allow-list. |

For all three: never cached (as #74 decides), the output schema is strict
about what it names, and the redaction tests of #74 run against the typed
result as well.

## Not typed yet

- **`get_assignment_detail`**: the `view` and `sections` answers have no
  recorded field list (`docs/reference/schoolsoft-api.md`, "Response shapes
  not listed above"). Nothing to type from; E4.6 records them.
- **`get_grade_prognosis`**: the reconciliation-dates answer was observed as
  an empty array; its item shape is unknown. E4.6 (or a child with dates).

Both keep their raw outputs, their JSON fallback in `--format text`, and no
`doctor --verify` entry, exactly as today.

## Surfaces

- **MCP.** Each newly typed tool declares its `outputSchema` and always
  carries `structuredContent`; its errors are the two text lines (the E4.1
  rule for typed tools).
- **CLI.** JSON in the new shapes; drift exits 7 with two lines; each typed
  operation has a `--format text` view (the boundary test requires one).
- **`doctor --verify`.** Every newly typed read is verified: all take `{}`
  plus `fresh`, so no exclusion is needed. Browser-served ones are skipped
  without the browser, gated ones without the web session, as today.
- **REST, OpenAPI and the typed client.** The connector offers
  `list_children`, `get_schedule`, `get_calendar` and `get_lunch_menu` only
  (`CONNECTOR_OPERATIONS`). None of the operations typed here is offered, so
  no route, no OpenAPI schema and no client change follows. Offering one is a
  separate decision (consent scope, other families' data), not a side effect
  of typing.
- **Docs and skills.** `make docs skills` renders the Output tables.

## Stability

Typing an untyped operation changes what its CLI JSON and MCP structured
content return, and moves its MCP errors from `structuredContent.error` to
the typed-tool form, which the stability policy calls breaking for that
operation ("Typing an untyped operation is itself a breaking change … and is
marked so"). Each group's commits that type operations are marked `!` with a
`BREAKING CHANGE:` footer. Nothing is published to a registry yet (0.4.0 is on
hold, #56), so no one migrates; the pull requests say so.

## Field provenance

"Name verified" means the field name appears in the shapes recorded live on
2026-09-06 (`docs/reference/schoolsoft-api.md`). No live JSON or page is
committed; fixtures are synthetic, built to those names. Everything else is
**assumed, verify in the live pass (E4.6)**.

| Domain field | Raw source | Status |
| --- | --- | --- |
| `Assignment.id` | start-page `id` | name verified; integer assumed |
| `Assignment.subjectRoomId` | `activityId` | name verified; integer assumed; that it is the subject room's `activityId` assumed |
| `Assignment.title`, `subtitle` | `title`, `subTitle` | names verified; string (or null for `subTitle`) assumed |
| `Assignment.date` | `sortDate` | name verified; format assumed (date, local date-time or epoch ms accepted); meaning (due date) assumed |
| `Assignment.read` | `read` | name verified; boolean assumed |
| `Assignment.submissionStatus`, `resultStatus` | `submissionStatus`, `resultReportStatus` | names verified; string or number assumed; values not recorded |
| `NewsItem.id` | news `id` | name verified; string or integer accepted |
| `NewsItem.title`, `body` | `title`, `description` | names verified; string assumed; whether `description` holds HTML assumed not |
| `NewsItem.category`, `author` | `category`, `author` | names verified; string (or number for `category`) or null assumed; `author` as an object would be drift |
| `NewsItem.read`, `hasAttachments` | `read`, `hasAttachment` | names verified; boolean assumed |
| `NewsItem.publishedAt` | `creDate` | name verified; format assumed (as `Message.sentAt`) |
| `NewsItem.visibleUntil` | `toDate` | name verified; format and nullability assumed |
| (not mapped) | news `newsConfirm` | name verified; type unknown, left out until E4.6 |
| `SubjectRoom.id`, `name`, `groups` | subjectroom/all `activityId`, `subject`, `groupNames` | names verified; integer, string, string[] (nullable) assumed |
| (filter) | `isSubjectRoom` | name verified; boolean or absent assumed; `false` is left out as before |
| `SubjectRoom.teachers[].name`, `role` | teachers `firstName` + `lastName`, `role` | names verified; strings assumed, `role` string or number |
| `Booking.title`, `description`, `details` | `.accordion-heading-left > div`, `[id^=description]`, `.inner_right_info` label + value | selectors observed; texts synthetic |
| `Booking.start`, `end` | `.accordion-heading-date-wide` text | selector observed; the `YYYY-MM-DD HH:MM[ - HH:MM]` format is assumed from the synthetic fixture |
| `Booking.status` | words in the detail values | word list assumed; `unknown` when none matches |
| `SharedFile.*` | `#library_con_content` `.h3_bold`, `td > a[href]` | selectors observed; relative `file_download.jsp` links and the extension rule assumed |
| `TablePage.*` (group B) | generic table extractor | structure observed per page (see the reference); cell meanings not recorded |
| `StudentDocument.*` (group B) | `Rubrik / Skapad av / Datum` columns, `requestid` in the row link | columns observed; the `YYYY-MM-DD` date format assumed from the synthetic fixture |

## I/O and edge cases

| Input or condition | Required behaviour |
| --- | --- |
| Upstream renames, drops or retypes a required field (API) | `response_drift` naming the operation; nothing returned or cached; session kept |
| Subject-room teachers answer drifts for one room | the whole operation drifts; no partial list |
| A booking's time text in an unknown format | `response_drift` naming `get_bookings` |
| A booking or file entry with an empty title or name | skipped by the extractor, as before (not drift) |
| Optional text empty, null, absent or whitespace | `null` |
| `get_news` with `limit` | at most `limit` items after mapping (the whole answer is still validated) |
| Same upstream entry on two calls | same id |

</frozen-after-approval>

## Code Map

- `src/core/domain/schemas.ts`: the Group A (and later B) types.
- `src/core/operations/get-{assignments,news,subject-rooms,bookings,files}.ts`: `output`, `childRef`.
- `src/core/portal/types.ts`: `Portal` returns domain types for these capabilities; the raw `Booking`, `PortalFile`, `SubjectRoom` shapes leave core.
- `src/providers/schoolsoft/portal/domain/{assignments,news,subject-rooms,bookings,files,ids}.ts`: raw schemas and mappers; `parse.ts` gains `label` and `dateOrDateTimeOrEpoch`.
- `src/providers/schoolsoft/portal/api/{webview,eva}-api.ts`, `browser-portal.ts`, `extractors.ts`: call the mappers; the extractors return text only.
- `src/cli/text/renderers/`: one view per newly typed operation; `registry.ts`, `labels.ts`.
- `test/fixtures/json/`: synthetic `assignments-week.json`, `news.json`, `subjectrooms.json`, `subjectroom-teachers.json`.

## Tasks & Acceptance

- [x] Spec (this file).
- [ ] Group A: given live-shaped synthetic fixtures, each of the five returns its domain shape; MCP lists its `outputSchema`; a renamed, a missing and a wrong-typed field each give one drift error naming the operation, nothing cached, session kept; each has a text view; `doctor --verify` covers it.
- [ ] Group B: the same for the five gated operations.
- [ ] After #74: `get_contacts`, `get_message`, `get_activity_log`, preserving its redaction.
- [ ] Live pass (E4.6): confirm every "assumed" row above; record `get_assignment_detail` and `get_grade_prognosis` fields.

## Verification

See the pull requests for the gate results.
