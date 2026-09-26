---
title: Absence report (first write operation)
type: feature
created: 2026-09-21
status: in-progress
route: dispatch
baseline_commit: 50aed5fd57250a7ad1dc928c1280cf53a118d3ca
context:
  - AGENTS.md
  - docs/development/architecture.md
  - docs/reference/schoolsoft-api.md
---

# Absence report

Built offline. No SchoolSoft login, BankID round or request to schoolsoft.se took place; everything below runs against fakes written to the port interfaces.

<frozen-after-approval>

## Intent

A guardian can ask their local agent to report a child absent (sjukanmälan / frånvaroanmälan) for a day, part of a day or a short run of days. It is the first operation that changes anything at SchoolSoft, so it is off until the guardian enables it, shows what it would send before sending, and never sends twice on its own.

## Verified and assumed

| Claim | Status |
| --- | --- |
| `POST /rest-api/parent/absence-notice` exists; GET answers 405 | verified live (Täby, 2026-09-06; see the API reference) |
| `right_student_absence.jsp` has four POST forms | verified live; kept as a documented fallback, not implemented |
| The endpoint takes the app cookies bound to the child in focus, like the other `/rest-api/parent/` routes | assumed |
| Request body field names, date and time formats, whether the child is named in the body | **unknown**; one mapper (`toAbsenceNoticeBody`) holds the guess |
| Success status and response body | **unknown**; any 2xx is success and the body is returned untouched |
| Part-day semantics (times, lessons, or both; allowed over several days) | **unknown**; part-day is limited to one date |
| Whether a repeated report duplicates, replaces or is refused | **unknown**; hence non-idempotent and never retried |

## Boundaries

One operation file, one registry line, one portal capability (`reportAbsence`) routed statically to the API, one backend class. MCP tool, CLI command, docs and skills are generated. No browser path and no JSP form post.

The safety gate is deliberately small: a config switch `allowWrites` (env `SCHOOLSOFT_ALLOW_WRITES`, default off) and preview-unless-`confirm`. The full write framework (idempotency keys, audit log, a remote OAuth write scope, provider-level enforcement of the switch) is a separate later spec and should absorb this gate. The parent-hosted HTTP connector does not list or run the operation.

## I/O and edge cases

| Input or condition | Required behavior |
| --- | --- |
| `allowWrites` off (default) | `not_available` / `writes_disabled` before any session use, preview included |
| No `confirm` | Preview: child, dates, times, reason, summary; no request, no child-focus change |
| `confirm: true` | Focus the child, exactly one POST with the mapped body |
| No dates | Today in Europe/Stockholm |
| Start before today (Stockholm), end before start, more than 14 days, malformed date | `input` / `absence_window` |
| One of `from_time` / `to_time`, `to_time` not after `from_time`, malformed time, times with a multi-day range | `input` / `absence_window` |
| `child` name and `child_id` disagree, unknown or ambiguous name | `input` |
| Several children and neither `child` nor `child_id` | `input` / `absence_child_required`; a write never falls back to the child in focus |
| 401/403 on the POST | Session is renewed silently, the POST is **not** repeated, `write_not_repeated` |
| Network failure or 5xx on the POST | `write_outcome_unknown`, not retryable: the request may have been applied |
| Other 4xx | `absence_rejected` with the status, not retryable |

</frozen-after-approval>

## Code Map

- `src/core/operations/report-absence.ts`, `_absence-window.ts`: operation, gate, validation (reuses the Stockholm date helpers of `_calendar-range.ts`).
- `src/core/portal/types.ts`: `reportAbsence`, `AbsenceNotice`, `WRITE_CAPABILITIES`; `recovering.ts`: writes are not repeated.
- `src/core/config.ts`: `allowWrites` through the existing source chain (env, config file).
- `src/providers/schoolsoft/portal/api/absence-api.ts` (backend), `absence-notice-body.ts` (the unverified body), `transport.ts` (`postWrite`), `routing.ts`.
- `src/core/errors/messages.ts`: new message and hint keys, English and Swedish.

## Tasks & Acceptance

- [x] Gate. Given default config, when the operation runs, then it fails with `writes_disabled` and touches nothing.
- [x] Preview. Given writes enabled and no `confirm`, then the result describes the report and the portal is never called.
- [x] Send. Given `confirm: true`, then one POST carries the mapped body and the raw response is returned.
- [x] Validation in Europe/Stockholm, including both DST changes and the midnight boundary.
- [x] Retry safety. Given a rejected session or an ambiguous failure, then no second POST is issued.
- [x] Connector. The remote tool list and scopes do not contain the operation.
- [ ] Live acceptance (below).

## Design notes

**Error kind.** `writes_disabled` uses the existing `not_available` kind (exit 5): the capability exists but this configuration does not offer it. A new kind would have added an exit code for one message.

**Retry safety.** `withSessionRecovery` repeats a call after a silent re-login. For capabilities in `WRITE_CAPABILITIES` it still renews the session, so the next call works, but throws `write_not_repeated` instead of calling again. A 401 almost certainly means nothing was stored, yet the wrapper cannot know what a vendor did before rejecting, and the guardian loses little by confirming once more. Transport failures and 5xx on a write are reported as outcome unknown and not retryable for the same reason.

**Redirects.** The bundled HTTP helper follows 301/302/307/308 by issuing the same method again. For reads that is harmless; for a write it is a second POST. `postWrite` therefore disables redirect following, and any 3xx is reported as `absence_rejected` with its status. Whether SchoolSoft ever redirects this endpoint (for example to the login page on a dead session) is a live question.

**Child selection.** `child_id` matches every other operation; `child` (first or full name) is added because a write should be addressable the way a parent speaks. With more than one child an explicit choice is required.

**Where the switch is enforced.** In the operation only. The provider does not see `Config`; pushing the switch into the API portal belongs to the framework spec.

## Live acceptance outstanding

The live pass must record, with names and free text redacted: the request body the portal's own form sends (field names, date/time formats, child reference, reason codes if any), the success status and response shape, how part-day absence is expressed and whether it may span days, what a duplicate report does, and whether the app-cookie session is accepted or the web session is required. Correct `toAbsenceNoticeBody`, its test and the API reference row accordingly.

## Verification

- `make check`: passed; 292 tests, no skips, 100% statements, branches, functions and lines.
- `make check-ci`: passed.
- `make e2e-artifact`: 11 tests passed, no skips.
- `make e2e` (live) was not run. Nothing here has been exercised against SchoolSoft.
