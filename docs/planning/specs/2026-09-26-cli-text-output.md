---
title: CLI output for humans
type: feature
created: 2026-09-26
status: in-review
route: dispatch
baseline_commit: d83aca4ce46d7aa0d893f4c411cdf2d2de5b4dcb
context:
  - AGENTS.md
  - docs/development/architecture.md
  - docs/planning/specs/2026-09-26-typed-domain-model.md
  - https://github.com/grimen/schoolsoft-agent/issues/34
---

# CLI output for humans (E11.1)

The CLI prints JSON, which is right for agents, the skill and scripts, and tiring for a parent who just wants to see this week's schedule in a terminal. This change adds a text view for the five operations that return typed domain objects, behind an explicit flag, and leaves every byte of today's JSON alone. Built offline: no SchoolSoft login, no BankID round and no request to schoolsoft.se took place.

<frozen-after-approval>

## Intent

`schoolsoft-agent get-schedule --format text` prints a week view a person can read; without the flag, or with `--format json`, the output is exactly what it is today. Text views exist for `list_children`, `get_schedule`, `get_calendar`, `get_lunch_menu` and `get_messages`. Every other command still prints JSON, pretty-printed, and says so on stderr.

## Scope

In: a global `--format json|text`, one text renderer per typed operation in the CLI adapter, a renderer registry keyed by operation name, a label table in Swedish and English, Stockholm date and time formatting, terminal width and colour handling, generated docs that show the flag, a getting-started page with a sample of each view.

Out: text views for the 20 operations that still return raw portal JSON (they wait for E4.5), a text default when stdout is a terminal (the stability policy, E3.3, decides that), a `SCHOOLSOFT_FORMAT` environment variable (same reason), the TUI (E11.3), anything on the MCP server or the connector. The issue asks for "every read command"; this spec narrows it to the typed five and says why below.

## The flag

`--format <json|text>` is a global option like `--pretty`, accepted before or after the command. Absent means `json`.

- **JSON stays the default everywhere.** Agents, the skill's scripts and anyone's shell pipelines parse stdout today. A default that changed with the flag's arrival, or with whether stdout is a terminal, would break a script the day a user runs it by hand to debug it. The JSON path is the same `JSON.stringify(data, null, pretty ? 2 : 0)` as before, so `--format json` and no flag are byte-identical to today, with and without `--pretty`. A regression test runs every operation both ways.
- **Whether a TTY may default to text later is deferred** to the stability policy (E3.3): it is a promise about the CLI's contract, not a rendering detail. Nothing here reads `isTTY` to choose a format.
- **A bad value is an input error.** `--format xml` is an `InputError` (exit 6, the usual two lines on stderr: problem, "Next: …"), raised before the command runs, so a typo never reaches SchoolSoft. The check runs in a commander `preAction` hook rather than commander's `choices()`, because commander's own error is one English line and would bypass `describeError`.
- `--pretty` only affects JSON. With `--format text` it is ignored.

## Which operations get a view, and the fallback

| Operation | View |
| --- | --- |
| `list_children` | the guardian's name, then a table: marker for the child in focus, id, first name, school, class |
| `get_schedule` | week heading, then one block per day (weekday and date), lessons sorted by start with `HH:MM–HH:MM`, title and room |
| `get_calendar` | period heading, then a date-grouped agenda: all-day and date-only entries first as "All day", then timed entries with times and location; a multi-day entry shows where it ends |
| `get_lunch_menu` | week and year heading, then Monday to Friday (plus Saturday or Sunday only when the school lists them), each dish as `kind: description`, "No menu" for a missing weekday |
| `get_messages` | inbox heading with the unread count, then a table: unread marker, id, date and time, sender, subject, attachment marker |

Empty states are sentences, not blank screens: "No lessons this week.", "Nothing in the calendar for this period.", "No lunch menu for this week.", "No messages.", and a guardian without children gets "No children on this account."

**The other operations fall back to pretty JSON with a one-line note on stderr** (`Text view is not available for get-news yet; showing JSON.`, in Swedish when the user's language is Swedish), exit 0. Their results are SchoolSoft's raw shapes, which E4.5 will replace with domain types; a renderer written against them now would be rewritten then, and would silently print blanks when SchoolSoft renames a field, which is exactly what typing is meant to prevent. Pretty JSON is still readable, stdout stays parseable, and the note tells a person why they did not get a table. `configure`, `doctor`, `browser …` and `login --background` go through the same fallback.

## Where renderers live

In the CLI adapter, `src/cli/text/`, never in core.

- One file per operation in `src/cli/text/renderers/` exports a `TextRenderer`: a pure function from the operation's result and a `RenderContext` (language, width, today's Stockholm date) to lines. A line is plain text or text marked as emphasis; renderers never write escape codes.
- `src/cli/text/registry.ts` maps operation name to renderer. A new view is one file plus one registry line (open/closed); `program.ts` does not change.
- **Not on `Operation`.** An optional `text` field on the operation definition would be the shortest path, but it puts a terminal concern into core, which AGENTS.md forbids, and core would then grow a renderer per surface (the TUI, the app). The registry sits on the CLI side of the boundary and is keyed by the same names the registry already uses.
- **A test keeps the registry honest:** every operation that declares `output` has a renderer, and every renderer key names such an operation. When E4.5 types another operation, that test fails until its view exists, so "typed" and "has a text view" cannot drift apart.
- The result types come from the domain types core already exports (`Child`, `Lesson`, `CalendarEvent`, `LunchDay`, `Message`, `ChildRef`); `core/index.ts` gains those type exports and `isoWeekDate`/`DOMAIN_TIMEZONE`, nothing else. `runOperation` has already validated the result, so renderers trust the shape.

## Language

Headings and labels (weekday names, "Unread", "All day", column headers, empty states, the fallback note) are in one table, `src/cli/text/labels.ts`, with English and Swedish for every key; a test fails when a key misses a language or has an empty string. The language comes from the same `detectLang` the error messages use (`SCHOOLSOFT_LANG`, else `LC_ALL`/`LC_MESSAGES`/`LANG`), so a Swedish user sees Swedish errors and Swedish views.

Dates are printed as ISO `YYYY-MM-DD` with a short weekday name (`Mon 2026-08-31`, `mån 2026-08-31`) and times as 24-hour `HH:MM` in both languages: unambiguous, the Swedish convention, and no month-name table to maintain.

## Time

Every date and time is formatted for Europe/Stockholm from the domain's ISO values, never the machine's time zone. A `DateTime` is parsed as an instant and formatted through `Intl.DateTimeFormat` with `timeZone: "Europe/Stockholm"`; a `LocalDate` is used as it is. So a lesson at `2026-09-07T00:30:00+02:00` is on Monday 7 September even on a laptop set to UTC, and both 02:30 instants of the autumn fold show as 02:30 on 25 October. A calendar entry is all-day when `allDay` is true or when either end is a `LocalDate`. "Today" (for emphasis) is Stockholm's date at the injected clock (`CliDeps.now`, defaulting to `Date.now`).

## Terminal behaviour

`CliDeps` gains two optional fields with production defaults in `src/cli/index.ts`: `isTTY` (`process.stdout.isTTY`) and `columns` (`process.stdout.columns`). Tests inject them.

- **Colour** only when stdout is a TTY, `NO_COLOR` is unset or empty, and `TERM` is not `dumb`. It is used for emphasis only: bold for unread messages and today's heading, through a four-line ANSI helper. No dependency: bold is the only style, and a colour library would be the largest thing in the CLI for one escape sequence. Without colour the views carry the same meaning in text (the `*` unread marker, "(today)").
- **Width:** a valid `COLUMNS` (an integer, at least 20) wins because the user set it; otherwise the TTY's `columns`; otherwise (a pipe or a file) there is no limit, so `grep` sees whole lines. Table views shrink their one flexible column (school, lesson title, calendar title, subject) first; every line is then cut to the width, so no line is ever longer than the width.
- **Truncation** ends in `…` and cuts between grapheme clusters (`Intl.Segmenter`), so `å`, `ä` and `ö` count as one column whether they arrive precomposed or as a letter plus a combining ring, and a cut never splits a character. Wide East Asian characters and emoji count as two columns. Padding uses the same measure, so columns line up with Swedish names.
- **Hostile text stays text.** Portal strings are collapsed to one line and C0/C1 control characters (including ESC) are removed before they reach the terminal, so a subject line cannot move the cursor or change colours.
- No new runtime dependency.

## Errors

Unchanged, whatever the format: two lines on stderr from `describeError` and the same exit codes. A text view is only rendered from a successful, validated result.

## I/O and edge cases

| Input or condition | Required behaviour |
| --- | --- |
| No `--format`, or `--format json`, with or without `--pretty` | stdout byte-identical to before this change |
| `--format text` on a typed operation | its view on stdout, nothing on stderr, exit 0 |
| `--format text` on any other command | pretty JSON on stdout, one localized note on stderr, exit 0 |
| `--format` with another value | `input` error, exit 6, two lines, command not run |
| Operation fails with `--format text` | the usual two error lines, the usual exit code |
| Empty result | the view's empty-state sentence |
| Lesson or event time in the autumn fold or spring gap | the Stockholm wall-clock time of that instant |
| Machine time zone is not Stockholm | same output |
| Date-only or `allDay` calendar entry | "All day", listed first under its date; a later end date is shown |
| Missing optional text (room, class, sender) | an en dash |
| `COLUMNS` / TTY width narrower than a line | flexible column shrunk, then the line cut with `…`, never mid-grapheme |
| Stdout not a TTY, or `NO_COLOR` set | no escape sequences |
| Control characters or newlines in portal text | removed or collapsed before printing |

</frozen-after-approval>

## Code Map

- `src/cli/program.ts`: `--format`, the `preAction` check, `emit` choosing JSON, a view or the fallback.
- `src/cli/text/`: `labels.ts` (strings), `terminal.ts` (width, graphemes, truncation, sanitising, colour decision), `time.ts` (Stockholm formatting), `render.ts` (context, lines to output), `table.ts`, `registry.ts`, `renderers/*.ts`.
- `src/cli/index.ts`: `isTTY`, `columns` defaults.
- `src/core/index.ts`: domain type exports, `isoWeekDate`, `DOMAIN_TIMEZONE`.
- `scripts/gen-docs.ts`: the global flag line and a "Text view" line per command.
- `test/unit/cli-text-*.test.ts`, `test/functional/cli-format.test.ts`, `test/boundary/registry.test.ts`.
- `docs/getting-started/terminal.md`, `README.md`, `docs/development/architecture.md`.

## Tasks & Acceptance

- [x] Spec (this file).
- [ ] Given each typed operation and `--format text`, when it runs against synthetic fixtures in English and Swedish, then stdout equals the stored view.
- [ ] Given every operation, when run without `--format`, with `--format json` and with `--pretty`, then stdout is byte-identical to `JSON.stringify` of the result as before.
- [ ] Given an untyped operation and `--format text`, then pretty JSON and one note.
- [ ] Given `--format xml`, then exit 6 and two lines.
- [ ] Registry test: every typed operation has a renderer.

## Verification

See the pull request for the gate results.
