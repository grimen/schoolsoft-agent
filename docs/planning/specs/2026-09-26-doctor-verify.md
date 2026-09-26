---
title: doctor --verify, a live parse check of the typed operations
type: feature
created: 2026-09-26
status: in-review
route: dispatch
baseline_commit: d83aca4
context:
  - AGENTS.md
  - docs/development/architecture.md
  - docs/planning/specs/2026-09-26-typed-domain-model.md
  - docs/planning/specs/2026-09-26-capture-probe.md
  - https://github.com/grimen/schoolsoft-agent/issues/27
---

# doctor --verify: does every typed operation still parse? (E4.4)

The live suite cannot run in CI (BankID), so until now the only early warning that SchoolSoft changed a response shape was a parent hitting a `response_drift` error in the middle of a question. `doctor --verify` lets a parent, or the maintainer before a release, ask once, with the session they already have, which operations still parse against the live portal. It sends nothing to SchoolSoft but ordinary reads and prints no data. Built offline: no SchoolSoft login, no BankID round and no request to schoolsoft.se took place.

<frozen-after-approval>

## Intent

One command reports, per typed read operation, `ok`, `drift`, `skipped` or `error`. For drift it shows only the field paths and issue codes `ResponseDriftError` already carries. It never shows a value, a name, an id or any other child data, never writes, never logs in and never triggers BankID.

## Scope

In: a verification engine in core, `doctor --verify` and `--all-children` in the CLI, a registry test that keeps the engine's input rule honest, `make verify-live`, the troubleshooting page, the live-pass section of CONTRIBUTING and the architecture page.

Out: a text view of the report (a sibling story adds `--format text`; the report is a plain object a renderer can use), an MCP tool or connector/REST endpoint (see below), inputs derived from another operation's answer (a typed `get_message` would need an id from `get_messages`; until then such an operation is excluded with a reason), the untyped operations (they have no schema to check against; E4.5 types them and they are verified from then on without a change here).

## Which operations

**The registry decides.** The engine selects every operation that declares `output`, is `readOnly`, not `destructive`, and `requiresAuth`. Today that is `list_children`, `get_schedule`, `get_calendar`, `get_lunch_menu` and `get_messages`, in registry order. A newly typed read operation is verified automatically. `report_absence`, `login`, `logout`, `auth_status` and `find_school` are never selected: the first three have side effects, the last two declare no output.

**Safe default inputs, derived, not written.** Each operation runs once through `runOperation` with `{}` plus:

- `fresh: true` when its input declares `fresh`, so a cached copy cannot hide drift (the cache stores only mapped values, so a hit would say nothing about today's shape);
- `child_id` only with `--all-children`.

`{}` means each operation's own defaults: the current ISO week (`get_schedule`, `get_lunch_menu`), the current Monday to Sunday in Europe/Stockholm (`get_calendar`), the first 20 inbox entries (`get_messages`), the child in focus. These are the reads a parent makes every day, so the check costs SchoolSoft nothing unusual.

**Registry test.** `test/boundary/registry.test.ts` asserts that every selected operation's input accepts `{}` (the engine's rule) or is listed in `VERIFY_EXCLUSIONS` with a non-empty reason. An operation that needs an input (a message id, a subject name) therefore fails the test the day it is typed, and its author either gives it a safe default or excludes it with a reason. Excluded operations are reported as `skipped` with that reason, so the report stays complete. The list is empty today.

**Gated and browser-backed operations.** An operation that uses a capability in the provider's `webSessionCapabilities` runs only when a web session is saved; otherwise it is `skipped` with reason `web_session_required`. One that uses a capability the provider routes to the browser runs only when the browser is installed (`browserStatus().ready`); otherwise `skipped` with `browser_not_installed`. Both checks are local and happen before any request. None of today's five is gated or browser-backed; the rule is there so E4.5's operations need no change here.

## Children

**One child by default: the child in focus.** It is the child every other command defaults to, so verifying it needs no child switch (no extra cookie exchange) and changes nothing. The report names it by position in the account's child list (`"children": { "total": 2, "verified": [1] }`), never by name or id.

**`--all-children`** runs each child-scoped operation (input declares `child_id`) once per child, in list order, grouped by child so each child costs one switch. Account-level operations (`list_children`) run once. Each result carries the child's position. Afterwards the child that was in focus before is put back in focus, because the child in focus is persisted and a check must not change which child later commands default to.

## Output

JSON on stdout, like every command (`--pretty` applies). The report is a plain object:

```json
{
  "ok": false,
  "session": "ok",
  "children": { "total": 2, "verified": [1] },
  "summary": { "ok": 4, "drift": 1, "skipped": 0, "error": 0 },
  "results": [
    { "operation": "list_children", "status": "ok" },
    {
      "operation": "get_schedule",
      "child": 1,
      "status": "drift",
      "at": "getScheduleWeek",
      "detail": "0.startDate invalid_type"
    },
    { "operation": "get_calendar", "child": 1, "status": "ok" },
    { "operation": "get_lunch_menu", "child": 1, "status": "ok" },
    { "operation": "get_messages", "child": 1, "status": "ok" }
  ]
}
```

| Status | Fields besides `operation` and `child` |
| --- | --- |
| `ok` | none; the result is discarded unread |
| `drift` | `at` (the capability or operation that noticed) and `detail`, both straight from `ResponseDriftError` |
| `skipped` | `reason`: `web_session_required`, `browser_not_installed`, `excluded` (with `note`, the exclusion's reason) or `session_drift` |
| `error` | `kind` (the error kind), `code` (the message key), `retryable`, and `httpStatus` for an HTTP answer |

**No data, by construction.** A successful result is thrown away without being inspected. Drift detail is what `describeIssues` produced: field paths (schema keys and list indexes, never record keys, since no raw schema uses records) and Zod issue codes or the provider's fixed custom messages, at most three plus a count; never values. Errors are reported by kind and message key, not by their rendered message, because a message's parameters may carry text from the portal (an HTTP status line, a child's name in "no child with id"). The functional test serializes the whole report for a drifted run and asserts that none of the fixture's child names, ids, lesson titles, dishes or message texts appear.

**Session drift.** Every operation first establishes the session, which reads the guardian profile. If that profile no longer maps, nothing can be verified: `session` becomes `{ "status": "drift", "at": ..., "detail": ... }`, `children` is null and every operation is `skipped` with `session_drift`.

## Exit code

Consistent with `EXIT_CODE_BY_KIND`, through `verifyExitCode(report)` in core:

- any drift, in an operation or the session: **7** (`upstream`), the code a drift error has everywhere else;
- otherwise any error: the code of the first error's kind (4 network, 2 not logged in, 1 a bug, ...);
- all `ok` or `skipped`: **0**. A skip is not a failure: a parent without the browser has nothing to fix.

The report is printed in every case; the exit code adds no stderr lines.

## Session and traffic

**An existing session only.** The engine first calls `ensureSession()`. Without a saved session that throws the usual not-authenticated error (exit 2, "Next: login") before any request. A restore that needs a refresh does one, exactly as any command would; a session that cannot be restored is the same not-authenticated error. Nothing here calls `login`, opens a browser or reaches BankID.

**Sequential.** One operation at a time, one request chain each, in registry order. The engine goes through the normal context (`runOperation`, the same portal chain as every command: session recovery, network guard and whatever request budget the transport enforces). It adds no limiter of its own and inherits the transport's.

**Never writes.** Only selected operations run; a write is never selected (the functional test uses a portal whose `reportAbsence` throws if called). The only non-read request possible is the child-in-focus cookie exchange with `--all-children`, the same one any `child_id` read makes.

## Where it lives

**Engine in core** (`src/core/operations/verify.ts`, exported through `core/index.ts`): `verifyOperations(ctx, { allChildren, browserReady })` and `verifyExitCode(report)`. Pure: session manager, portal and provider arrive in the ordinary `OperationContext`; the browser's readiness is a boolean the caller measured. It iterates the registry, so it sits next to `run.ts`.

**CLI: `doctor --verify`** (`src/cli/commands/verify.ts`, registered as an option of the hand-written `doctor` in `doctor.ts`; `program.ts` is unchanged). With `--verify`, doctor runs only the verification; the environment checks remain plain `doctor`, which makes no authenticated request. `--all-children` without `--verify` is an input error.

**Not an MCP tool, not a connector or REST endpoint.** It is a maintenance command a person runs when something looks wrong or before a release, not something an assistant needs mid-conversation: a normal tool call already reports drift for the one operation it ran, and an agent looping over a verification tool would multiply traffic at SchoolSoft for no answer. On the connector it would let an AI app trigger reads across every operation, including ones the parent never granted it. It stays one command, run on purpose, locally.

**`make verify-live`** runs the built CLI's `doctor --verify --pretty` (live, local, like `make fingerprints` and `make capture`), documented in the live-pass section of CONTRIBUTING.

## I/O and edge cases

| Input or condition | Required behaviour |
| --- | --- |
| No saved session | not-authenticated error, exit 2, zero requests |
| Not configured | not-configured error, exit 3 |
| One operation's answer drifts | that result `drift` with `at` and `detail`, the others still run; exit 7 |
| Guardian profile drifts | `session` drift, every operation `skipped`/`session_drift`, exit 7 |
| Upstream 5xx or network failure in one operation | that result `error` with kind and code; exit 4 or 7 by kind when nothing drifted |
| Gated operation, no web session | `skipped`/`web_session_required`, no request |
| Browser-backed operation, no browser | `skipped`/`browser_not_installed`, no request |
| Operation excluded | `skipped`/`excluded` with the reason |
| Cached answer present | bypassed: `fresh: true` where declared |
| `--all-children` | each child-scoped operation per child; focus restored afterwards |

</frozen-after-approval>

## Code Map

- `src/core/operations/verify.ts`: selection, inputs, classification, `VERIFY_EXCLUSIONS`, `verifyExitCode`.
- `src/core/index.ts`: exports.
- `src/cli/commands/verify.ts`: the `--verify` action; `src/cli/commands/doctor.ts`: the two flags.
- `scripts/gen-docs.ts`: the doctor line of the command reference.
- `Makefile`: `verify-live`.
- `test/unit/verify-operations.test.ts`: the engine with fake operations and a real `SessionManager`.
- `test/functional/doctor-verify.test.ts`: the CLI through the production wiring over the offline SchoolSoft stand-in.
- `test/boundary/registry.test.ts`: every verifiable operation accepts `{}` or is excluded with a reason.
- `docs/getting-started/troubleshooting.md`, `CONTRIBUTING.md`, `docs/development/architecture.md`.

## Tasks & Acceptance

- [x] Spec (this file).
- [x] Given a saved session and live-shaped answers, when `doctor --verify` runs, then all five are `ok` and it exits 0.
- [x] Given one renamed field, then that operation is `drift` with path and code, the output contains no fixture value, and it exits 7.
- [x] Given a 5xx for one operation, then it is `error` (not drift) with kind `upstream` and `httpStatus`.
- [x] Given no saved session, then exit 2 and no request was made.
- [x] Given a cached answer, then the check reads anew (`fresh`).
- [x] Given `--all-children`, then each child-scoped operation runs per child and the original child is back in focus.
- [x] A write capability is never called.
- [ ] Live: run `make verify-live` in the next live pass (E4.6) and record the counts in the PR.

## Verification

See the pull request for the gate results.
