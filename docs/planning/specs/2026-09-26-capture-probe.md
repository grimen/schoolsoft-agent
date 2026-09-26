# Capture probe (E2.1)

Refs #25, story E2.1. Status: built offline; never run against SchoolSoft.

## Problem

Several structures were guessed without real pages: the absence, leave and message
forms (the write specs), the GDPR-gated Översikt page (no fixture, no extractor), and
a non-empty school-event agenda (only an empty one was ever seen). The next live
session should record them in one command, as fixtures safe to commit, so the live
pass stays short.

## What `make capture` does

With the session already saved (`make login`, and `make login-web` for Översikt) it:

1. restores the session; with none it stops with the usual not-authenticated error
   and hint, before a browser starts or a request is made;
2. visits `right_student_absence.jsp`, `right_student_studentleave.jsp` and
   `right_student_message.jsp` with the app session and records **form structure
   only**: action, method, field names, types, required flags, choices; never
   values, never a click or a submit;
3. visits `right_student_lesson_status.jsp` with the web session (after the usual
   child-in-focus alignment) and records the page as redacted HTML;
4. reads `/rest-api/parent/calendar/event/agenda` for today −7…+60 days, and if that
   is empty for −120…+240 days, and records the response as redacted JSON;
5. writes everything to `.captures/` (gitignored, 0600 files) with a manifest naming
   each file's future fixture path.

It does not call `POST /rest-api/parent/absence-notice` or any other write. The
browser session is opened without `allowWrites`, so the session guard aborts any
non-GET request a page makes.

Declarations live in `src/providers/schoolsoft/capture/targets.ts`; the flow in
`capture.ts` with every dependency injected; `scripts/capture.ts` only wires the
real session, browser and HTTP.

## Redaction

Fail closed (`redact.ts`): a text is kept only if it is a date, a time, a short
number, or made entirely of SchoolSoft interface words (`vocabulary.ts`). Every
other text node, attribute text, title, JSON string and option label becomes a
placeholder `[text N]`. Identifiers become stable numbers from 1001 (by JSON key,
by URL query key ending in `id`, and any run of three or more digits in element
ids, names and URLs); the same id or text maps to the same placeholder within one
capture. Script bodies, comments and textarea contents are dropped; `mailto:` and
`tel:` links are cut; input values are blanked except choice codes and button
captions. Names the session knows (children, guardian, schools, tenant slug) are
never kept, even when they look like interface words.

## Promote

`make capture-promote` moves the files named in the manifest into `test/fixtures/`
(forms under `forms/`, Översikt under `jsp/`, the agenda under `api/`) only if none
of them still looks personal: e-mail, phone, national-id-like and long numbers,
two capitalised non-interface words, the maintainer's `.capture-denylist`
(gitignored, one name per line) and the capture's own known names, stored only as
salted SHA-256 hashes. One finding anywhere and nothing moves; findings name the
rule and line, never the text. Moving is not committing: the maintainer reads the
diff first.

## Tests

Offline, synthetic samples only: tokenizer, redactor, form extraction, the check and
promote step, and the whole flow with a fake browser session, including the
no-session path against a real `SessionManager`. The in-page `pageHtml` extractor
runs in real Chromium against synthetic pages in `make e2e-artifact`. No coverage
exclusion was added.

## Out of scope

The Översikt page declaration, extractor and fingerprint (E2.6) and the absence
body correction (E2.4) follow once the captured fixtures are reviewed and committed.
