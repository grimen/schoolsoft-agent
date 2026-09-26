# Live session runbook (E2)

One sitting with a real guardian login that answers every open live question in
[#25 (E2)](https://github.com/grimen/schoolsoft-agent/issues/25) and the specs, and
leaves nothing personal in git. The repository owner does every BankID signing;
nothing here automates BankID or logs in on its own.

Prepared 2026-09-26 from #25, #27, #8, #46, #49, #54, #57 to #61, `ROADMAP.md` (#44) and
the specs under `docs/planning/specs/`. Not run yet. Each open question has an ID
(`C1`, `A3`, …); the [question register](#question-register) says where its answer
goes, and [afterwards](#afterwards) says which follow-up each answer unblocks.

## Ground rules

- **Order:** reads before writes, captures first (so offline work can go on if the
  session dies), clocks started at login and read at the end, the one write last and
  only with consent.
- **Record answers, not data.** Raw observations go in `.captures/notes.md` (gitignored,
  never promoted). Anything leaving the machine is a field name, type, format, status
  code, count, duration, time or yes/no.
- **One request at a time.** Keep the default request budget, run steps in sequence,
  no loops or polling scripts, `make e2e` once. See [abort rules](#abort-rules).
- **BankID:** only you, only in your own browser or BankID app, only for a sign-in you
  just started. At most one retry per sign-in.
- **Writes:** only step 38, only for a real absence, only after you say yes to the
  preview. Never send twice.

## Preparation

### Merged and deployed

- [ ] **#58** (Referrer-Policy fix) merged **and deployed**. Without it, real browsers
      cannot use the owner dashboard: no owner sign-in, consent or SchoolSoft sign-in.
      Blocks phases 1 and 5.
- [ ] **#57** (reference page) merged and deployed, after #58. Needed for R1; skip R1
      otherwise.
- [ ] **#60** (composite overview) merged and deployed. Needed for R2; skip R2 otherwise.
- [ ] #61 (OpenAPI client), #59 (write spec) and #55 (release sync) need not be deployed.
      #59's question list is copied into the register.
- [ ] Your fork or server runs that `main` revision. Local checkout on the same commit:
      `git pull && make setup && make build`.

### Connector and hosting

- [ ] Primary connector on its public HTTPS address, healthy, owner sign-in page showing.
      This one gets the SchoolSoft sign-in.
- [ ] For E2.3, the other route up too: Render and Cloudflare Tunnel, one each. The
      secondary only needs the owner page (P1/P2), never a SchoolSoft sign-in.
- [ ] `SCHOOLSOFT_KEEPALIVE` **unset** on the connector for the sitting (clean
      measurements); decided in step 41.
- [ ] Admin password and storage key in your password manager, reachable on the phone.

### Tools

- [ ] Node 22+, `make setup`, `make build`, `make browser` (Chromium), `make doctor` clean.
- [ ] `jq`, `curl`, `gh`; Docker if a route runs on your machine.
- [ ] Desktop Chrome and Safari; a phone with Safari and Chrome.

### Accounts and apps

- [ ] Claude web and the Claude phone app on an account that allows custom connectors.
- [ ] ChatGPT web and the ChatGPT phone app on an account that allows custom
      connectors/apps. Check that **Add custom connector** exists before the day.
- [ ] SchoolSoft's own app or website, as you normally use it, for comparing answers
      and for the look-only checks (W3, W4, W9).

### Data and consent

- [ ] **A real absence** to report: a real child, today or up to 14 days ahead, of the
      kind the school expects as frånvaroanmälan (sick or appointment, not ledighet),
      with your consent to report it through this tool. A planned one is easier than a
      morning sick call. **None? Mark E2.4 (step 38) skipped** and say so in #25.
- [ ] Second school: do the children have a second SchoolSoft address (another
      municipality or an independent school)? If not, phase 6 is skipped.
- [ ] `.capture-denylist` (gitignored, one per line): every child's and guardian's first
      and last name, siblings, teachers and mentors you know, class and school names.
- [ ] A school event visible in SchoolSoft's own calendar within a week or two, with
      entries on its last day, for K1 to K5.

### Budget

- [ ] **Time:** about 4 hours in one sitting (phase 5 is the longest). Add 15 minutes if
      the absence falls back to SchoolSoft's own form. Weeks afterwards for L1 and L3 to L5.
- [ ] **Disk:** captures are small (well under 10 MB); Chromium and a local connector
      image need a few GB free.
- [ ] **Sign-ins:** three BankID signings (local app, local web, connector), plus one
      for a second school and one for the absence fallback, if they apply.

## The sitting at a glance

| Phase                     | Steps | BankID | Answers                          |
| ------------------------- | ----- | ------ | -------------------------------- |
| 1. Without BankID         | 1–5   | none   | H1, H5, P1, P2, T4               |
| 2. Local logins, clocks   | 6–9   | 2      | L6, clock start                  |
| 3. Capture first          | 10–13 | none   | X1–X3, O1, K5, W5                |
| 4. Local reads            | 14–19 | none   | V1–V3, M1–M3, K1–K4, F1, F2      |
| 5. Connector              | 20–31 | 1      | C1–C10, H1–H5, L7, R1, R2, W8    |
| 6. Second school (if any) | 32–33 | 1      | T1, T2                           |
| 7. Readings               | 34–35 | none   | L2, B1, clocks                   |
| 8. The one write          | 36–39 | 0 or 1 | A1–A6, W2–W4, W7, W9, W10        |
| 9. Wrap-up                | 40–43 | none   | L1, L3 schedule; notes to issues |

Start a timer at step 19 (last use of the local web session). Steps 34 and 35 run when it
rings, even in the middle of phase 5: each is one read.

## Steps

`cli` below means `node dist/cli/index.js` in the checkout. Output that could contain data
goes through `jq` or to `/dev/null`.

### 1. Without BankID

| #   | Do                                                                                                                                                                      | Record                                                    | Pass if                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1   | `make doctor`; `make status`. If a session exists from before, `make logout` so the clocks start today.                                                                 | revision, account key                                     | doctor clean; not logged in                                             |
| 2   | Primary connector, desktop Chrome: owner sign-in, read **Address check**, sign out. Repeat in desktop Safari, phone Safari, phone Chrome.                               | H1, H5 per browser; P1 or P2 (matches your IP: yes/no)    | no 403 anywhere; address check shows your own public IP (same network)  |
| 3   | Secondary route: owner sign-in, **Address check**, sign out. No SchoolSoft sign-in.                                                                                     | the other of P1/P2                                        | shows your own public IP with hops 1                                    |
| 4   | Slug case, without cookies or redirects: `for s in <slug> <Slug>; do curl -s -o /dev/null -w "$s %{http_code} %{redirect_url}\n" "https://sms.schoolsoft.se/$s/"; done` | T4: both statuses and whether the redirect keeps the case | recorded (first indication; the answer is "same tenant" or "not found") |
| 5   | Open `.captures/notes.md`; note the start time.                                                                                                                         | times only                                                |                                                                         |

A wrong address check: note the address it shows (locally only), leave the value at 1 and
decide in the E2.3 follow-up. Never raise hops past the point where your own address shows.

### 2. Local logins, clocks start

| #   | Do                                                                                                                                | Record                                                           | Pass if                                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| 6   | `make login`, BankID in your browser.                                                                                             | T_app                                                            | `make status`: authenticated                                       |
| 7   | Same browser, right away: open `https://sms.schoolsoft.se/<slug>/jsp/student/right_student_gradesubject.jsp`. Then `make status`. | L6: grades page, `right_student_app_blocked.jsp` or a login page | recorded; CLI still authenticated (if not: `make login` once more) |
| 8   | `make login-web`, BankID in the window it opens.                                                                                  | T_web                                                            | `cli auth-status \| jq '.sessionHistory.web'` is not null          |
| 9   | `cli auth-status \| jq '{authenticated, keepalive, portal, sessionHistory}'`                                                      | baseline history                                                 | `portal.state` is `ok`                                             |

Step 7 is issue #8's "one BankID, two sessions" question, answered by looking. If the grades
page shows, the OAuth login left cookies that pass the GDPR gate and E8.3 is promising.

### 3. Capture first

| #   | Do                                                                                                                                                            | Record                                                                                                                       | Pass if                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 10  | `make capture`                                                                                                                                                | X1: forms and fields counted, Översikt captured or skipped, agenda window (±60 or widened), exit                             | exit 0; manifest lists 3 forms, Översikt and the agenda            |
| 11  | Review every file in `.captures/` ([redaction](#redaction)).                                                                                                  | X3: interface labels that became `[text N]`; W5: hidden field names in the leave and message forms; O1: Översikt table shape | nothing personal left; fix or delete otherwise                     |
| 12  | `make capture-promote`                                                                                                                                        | X2                                                                                                                           | files moved; any finding: fix, repeat                              |
| 13  | `git switch -c test/live-captures`; read `git diff`; `make format`; `git checkout .release-please-manifest.json`; commit the files you read. Do not push yet. | K5: fields present in the agenda fixture                                                                                     | committed locally; `git show --stat` lists only `test/fixtures/**` |

From here the offline follow-ups (E2.4 body from the form, E2.6, E7.3, E7.4) have their
inputs, even if the session dies.

### 4. Local reads

| #   | Do                                                                                                                                                                                                                                     | Record                                                                             | Pass if                                      |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------- |
| 14  | `make verify-live`, then `cli doctor --verify --all-children --pretty`; then `make status` for the child in focus.                                                                                                                     | V1: `summary` counts, exit code; V2: report holds no data; V3: focus unchanged; M1 | every operation `ok` for every child, exit 0 |
| 15  | `cli get-schedule \| jq '[.lessons[].id] \| [length, (unique \| length)]'` for each child (`--child-id`); `cli get-lunch-menu \| jq '[.days[].weekday] \| unique'`                                                                     | M2: the two numbers; M3: weekdays seen                                             | numbers equal; weekdays recorded             |
| 16  | Calendar: `cli get-calendar --start-date <d1> --end-date <d2> \| jq '[.events[] \| {kind, allDay, start, end}]'` for the prepared range, a one-day range (`d1 = d2`) and a range ending mid-event. Compare with SchoolSoft's calendar. | K1 end day included; K2 one-day; K3 event across the edge; K4 all-day entries      | each comparison matches SchoolSoft           |
| 17  | `make e2e` (once; A3 forces a token refresh, A4 corrupts and restores the session).                                                                                                                                                    | pass/fail counts; `e2e-report.md` stays local                                      | all pass, or each failure noted              |
| 18  | `make browser-verify`                                                                                                                                                                                                                  | F1 per page                                                                        | every page `ok`                              |
| 19  | `make fingerprints`; `git diff src/providers/schoolsoft/portal/fingerprints.ts`. **Start the timer** (T_web_last).                                                                                                                     | F2: pages whose fingerprint changed                                                | only fingerprint strings and dates change    |

Keep the fingerprints diff on its own branch; it is its own PR.

### 5. Connector

| #   | Do                                                                                                                                                                                                                                  | Record                                                                | Pass if                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 20  | Desktop Safari, phone Safari, phone Chrome: owner sign-in, **Sign in with BankID**, stop at the "Complete BankID" page (do not open the link), sign out.                                                                            | H3 in three browsers                                                  | "Complete BankID" page, no 403                                           |
| 21  | Desktop Chrome: owner sign-in, **Sign in with BankID**, open the link, BankID, back to the owner page.                                                                                                                              | C1, C2, H3; T_conn                                                    | "SchoolSoft: connected". Otherwise stop phase 5 (the guide's checkpoint) |
| 22  | `make status`                                                                                                                                                                                                                       | L7: local session still alive after the connector's login             | recorded (either answer is a finding)                                    |
| 23  | Claude web: add `<connector>/mcp`. On the consent page (H2), pick one child (if two or more) and untick `get_calendar`. Ask for this week's lunch, the child's next school day, the other child's schedule, and next week's events. | C3, C4; W8: what Claude's tool permission UI offers ("Always allow"?) | lunch and day match SchoolSoft; other child and calendar refused         |
| 24  | ChatGPT web: same, with every child and all tools. Ask "What is happening at school next week, including events?"                                                                                                                   | C5; W8 for ChatGPT                                                    | answers match SchoolSoft                                                 |
| 25  | Phone apps: Claude, then ChatGPT. Is the connector there? Ask for lunch.                                                                                                                                                            | C6, C7; W8 on mobile                                                  | both answer; if missing, note the account or client, not SchoolSoft      |
| 26  | Reference page (#57): `<connector>/reference/` in desktop Chrome, phone Safari and phone Chrome. Connect, consent, switch child, next week, Reload. Leave each connected.                                                           | R1; H2 on phones                                                      | week matches SchoolSoft in each browser; no 403                          |
| 27  | Overview (#60): in a connected desktop reference-page tab, run [the snippet](#appendix-overview-check).                                                                                                                             | R2: status, week, section statuses, twice                             | `200`; all three sections `ok`                                           |
| 28  | 20 minutes or more after step 21: ask Claude for lunch again.                                                                                                                                                                       | C9; connector session age                                             | answer without "sign in again"                                           |
| 29  | Restart the connector (Render: restart from the service page; Docker: `docker compose -f <compose file> restart connector`). Owner page, then ask Claude for lunch.                                                                 | C8                                                                    | still "connected"; answer without BankID                                 |
| 30  | Owner page: disconnect ChatGPT (from desktop Safari) and each browser's own reference-page grant (desktop Chrome, phone Safari, phone Chrome). Reload the reference pages; ask both AI apps again.                                  | C10; H4 per browser                                                   | ChatGPT refused; Claude answers; pages back at Connect; no 403           |
| 31  | Read **Sign-in history** on the owner page; sign out.                                                                                                                                                                               | connector history (times only)                                        |                                                                          |

### 6. Second school (only if the family has one)

| #   | Do                                                                                                                                         | Record                 | Pass if                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- | ---------------------------------------------- |
| 32  | `cli --school <slug2> login`; then `cli --school <slug2> list-children \| jq '.children \| length'` and the same for `<slug>`.             | T1: children per login | each login sees only its own tenant's children |
| 33  | Right away and again 20 minutes later: `cli auth-status \| jq .authenticated` and `cli --school <slug2> auth-status \| jq .authenticated`. | T2                     | both stay `true` across a refresh              |

T3 (web cookies of two tenants in one browser) needs E3.4; record it as deferred.

### 7. Readings

| #   | Do                                                                                                                                                                    | Record                                                          | Pass if                    |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | -------------------------- |
| 34  | When the web session has been idle 25 minutes: `cli get-unreported-absence >/dev/null; echo "exit $?"`. Alive (0)? Wait another 40 idle minutes and run it once more. | L2: idle minutes and exit code of each probe (0 alive, 2 lost)  | recorded; a bracket for L2 |
| 35  | `cli auth-status \| jq '{portal, sessionHistory}'`                                                                                                                    | L1 (age so far), L2 (`longestGapSurvivedMinutes`, `losses`), B1 | `portal.state` `ok`        |

B1 is also every push-back seen during the sitting: an owner-page notice, a `portal`
state other than `ok`, exit 7 with `portal_slow_down` or `portal_paused`.

### 8. The one write

Only with a real absence and your consent. Step 36 only looks, in SchoolSoft's own app or
website.

| #   | Do                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Record                                                                                            | Pass if                                                |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 36  | In SchoolSoft's own UI: is there a list of reported absences, with a withdraw control? Same for leave applications and bookings. Open **new message**: can you pick yourself as a recipient? Close without sending. Any text about limits?                                                                                                                                                                                                                                                                                                                                                    | W3, W4 (baseline), W9, W10                                                                        | recorded; nothing clicked                              |
| 37  | Preview: `SCHOOLSOFT_ALLOW_WRITES=1 cli report-absence --child-id <id> --start-date <d> [--end-date <d>] [--from-time HH:MM --to-time HH:MM]`. No `--reason` (free text).                                                                                                                                                                                                                                                                                                                                                                                                                     | the preview matches the real absence                                                              | preview right; **say yes** before step 38              |
| 38  | Send once: the same command with `--confirm`, as `time … --confirm > .captures/absence-response.json; echo "exit $?"`. Never run it again.                                                                                                                                                                                                                                                                                                                                                                                                                                                    | W7: elapsed time; exit code; A2: response keys and status only                                    | exit 0                                                 |
| 39  | Exit 0: check SchoolSoft's own list (how soon it shows, right child, dates, part-day). Wrong? Fix it in SchoolSoft's UI. Exit 7 `absence_rejected`: confirm nothing registered, then report through SchoolSoft's own website (a normal web login, one more BankID) with the browser's developer tools open (Network, Preserve log; no HAR export). `write_outcome_unknown` or `write_not_repeated`: never resend; check the list; missing, report through SchoolSoft's UI. Last: open SchoolSoft's absence form for the same day and look whether it says the day is reported; do not submit. | A1, A3, A5 (exit 0 means app cookies are accepted), A4 (any 3xx status), W4 delay, A6 (look only) | the real absence is registered exactly once, correctly |

From developer tools, write down the request method, path, field names and value formats
(`YYYY-MM-DD`, `HH:MM`, how the child is named) and the response status, never values.

### 9. Wrap-up

| #   | Do                                                                                                                                                                       | Record                          | Pass if                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- | ---------------------------- |
| 40  | Leave the connector signed in, and the local session untouched, for E8.1.                                                                                                |                                 |                              |
| 41  | Decide on connector keepalive: `SCHOOLSOFT_KEEPALIVE=app` (one request about every 12 minutes) measures the absolute refresh limit; restarting to set it is a second C8. | choice, date                    | owner page still "connected" |
| 42  | Local L1 checks, each one read: `cli list-children >/dev/null; echo $?` at +1, +3, +7, +14 and +30 days; then `cli auth-status \| jq '.sessionHistory'`.                 | exit code and history per check | first failure brackets L1    |
| 43  | Copy answers (only) from `.captures/notes.md` into the follow-ups below; post the verify counts and a short summary on #25.                                              | —                               | notes stay local             |

## Redaction

- `make capture` redacts fail-closed (see the [capture probe](../planning/specs/2026-09-26-capture-probe.md)):
  anything that is not a date, time, short number or interface word becomes `[text N]`,
  ids become numbers from 1001, and the session's known names are never kept.
- `make capture-promote` refuses everything if one file still looks personal. It is the
  second check; your reading is the third.
- **Review each file before promoting:**
  - `grep -rniF -f .capture-denylist .captures` finds nothing;
  - `grep -rnE '[0-9]{6,}|@|\+46' .captures` finds only placeholders you can explain;
  - read titles, option labels, `title`, `alt`, `aria-label`, URLs with query strings and
    every JSON string;
  - what may stay: interface words, weekdays, dates, times, short numbers, `[text N]`,
    ids from 1001.
- **Never commit:** `.captures/` (including `notes.md` and `absence-response.json`),
  `e2e-report.md`, screenshots, developer-tools exports or HAR files, `auth-status`
  output with names. Never paste portal text into an issue, PR or spec.
- **Commit:** only `test/fixtures/**` from `capture-promote`, after reading `git diff`, and
  `make format` with `.release-please-manifest.json` reverted.
- **A slip:** not pushed, `git reset --soft HEAD~1` and fix. Pushed, delete the remote
  branch at once; a merged slip needs a history rewrite.

## Abort rules

| Signal                                                                                                                                              | Do                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Push-back: 429 or 5xx, `portal_slow_down`, `portal_paused`, the owner page's "SchoolSoft is pushing back"                                           | Stop everything that sends requests. No retries, no signing in again. Wait until `retryAt`. A second push-back ends the sitting. Record B1. |
| The breaker opens (`portal.state` `paused` or `probing`)                                                                                            | End the sitting; the captures and notes so far stand.                                                                                       |
| BankID: an error in the app, a request you did not start, a second failure on one sign-in                                                           | Cancel in the BankID app. Do not retry that sign-in today. Never share a code or QR image.                                                  |
| Account risk: a lock, CAPTCHA, "unusual activity", a message from the school or SchoolSoft, "Vi kunde inte hitta användaren", another family's data | Stop. `make logout`, **Disconnect everything** on the owner page, stop the connector. Tell no one the details in public; note times only.   |
| SchoolSoft rejects the connector's callback, or the sign-in stays pending                                                                           | Skip the rest of phase 5 (the guide's checkpoint). Repeating will not help.                                                                 |
| `write_outcome_unknown` or anything unclear about the absence                                                                                       | Never resend. Check SchoolSoft's own list; fix there.                                                                                       |
| Redaction doubt: promote refuses twice, or you see a name in a diff                                                                                 | Stop committing. Delete the capture file. Carry on with the reads.                                                                          |
| Over time, tired, or the session is lost twice                                                                                                      | Stop. Phases 3 and 4 already hold the offline inputs.                                                                                       |

Being a good citizen (E6): the default budget (20 requests a minute, 2 at once) stays,
nothing runs in parallel with the connector steps, and SchoolSoft AB is not involved in
this project and has not approved any of it.

## Question register

| ID    | Question                                                                                                                | Source                       | Step     | Answer goes to                                                                                            |
| ----- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------- | -------- | --------------------------------------------------------------------------------------------------------- |
| X1    | Does `make capture` run end to end on a real session?                                                                   | E2.1, #46                    | 10       | capture-probe spec status; #25 E2.1                                                                       |
| X2    | Does redaction leave nothing personal (your review and promote agree)?                                                  | E2.1, #46                    | 11, 12   | same                                                                                                      |
| X3    | Which interface labels became placeholders (vocabulary too small)?                                                      | #46                          | 11       | `src/providers/schoolsoft/capture/vocabulary.ts`                                                          |
| C1    | Does SchoolSoft accept the public HTTPS callback?                                                                       | E2.2, `connector.md`         | 21       | `connector.md` (acceptance section, release-candidate note), `hostinger.md`, `chatgpt.md`, support matrix |
| C2    | Does a real BankID completion leave the connector connected?                                                            | E2.2                         | 21       | same                                                                                                      |
| C3    | Are an unselected child and an unticked tool refused?                                                                   | E2.2                         | 23       | same                                                                                                      |
| C4–C5 | Claude and ChatGPT web: consent and tool calls, answers match SchoolSoft                                                | E2.2                         | 23, 24   | same                                                                                                      |
| C6–C7 | Claude and ChatGPT phone apps: connector available, tool call works                                                     | E2.2                         | 25       | same                                                                                                      |
| C8    | Does a restart keep the session and grants?                                                                             | E2.2                         | 29, 41   | same                                                                                                      |
| C9    | Do answers keep working after SchoolSoft's access token expired, without BankID?                                        | E2.2                         | 28       | same                                                                                                      |
| C10   | Does revoking one app stop it and leave the other working?                                                              | E2.2                         | 30       | same                                                                                                      |
| C11   | Does **Disconnect everything** end the session and every app's access?                                                  | E2.2                         | after    | same; run after the E8.1 window                                                                           |
| P1    | Render: is `SCHOOLSOFT_PROXY_HOPS=1` right?                                                                             | E2.3                         | 2, 3     | `connector.md` table, `render.yaml` comment                                                               |
| P2    | Cloudflare Tunnel: is `SCHOOLSOFT_PROXY_HOPS=1` right?                                                                  | E2.3                         | 2, 3     | `connector.md` table, `cloudflare.md`, `compose.cloudflare.yaml`                                          |
| H1–H5 | Owner sign-in, consent, SchoolSoft sign-in start, revoke, sign-out in desktop and phone Safari and Chrome               | #58                          | 2, 20–30 | comment on #58; `connector.md`                                                                            |
| A1    | Absence body: field names, date and time formats, how the child is named                                                | E2.4, absence spec           | 38, 39   | `portal/api/absence-notice-body.ts` and its test; absence spec table; API reference row                   |
| A2    | Success status and response shape                                                                                       | E2.4                         | 38       | same                                                                                                      |
| A3    | Part-day: times or lessons; may it span days?                                                                           | E2.4                         | 39       | same                                                                                                      |
| A4    | Does the endpoint redirect (for example to login)?                                                                      | E2.4                         | 38, 39   | same                                                                                                      |
| A5    | Are the app cookies enough, or is the web session needed?                                                               | E2.4                         | 38       | same                                                                                                      |
| A6    | What does a duplicate report do? (look only)                                                                            | absence spec, #59            | 39       | same; write spec                                                                                          |
| K1    | Is the end date inclusive?                                                                                              | E2.5                         | 16       | API reference "Full calendar agendas"; `connector.md` calendar paragraph                                  |
| K2    | Does a one-day range work?                                                                                              | API reference                | 16       | same                                                                                                      |
| K3    | Is an event crossing the range edge included?                                                                           | API reference                | 16       | same                                                                                                      |
| K4    | Are all-day entries right?                                                                                              | API reference                | 16       | same                                                                                                      |
| K5    | What does a non-empty school-event answer look like?                                                                    | E2.5, typed model            | 10, 13   | `test/fixtures/api/`; typed-model table (`CalendarEvent.*`)                                               |
| O1    | What is the Översikt page's real markup?                                                                                | E2.6                         | 10, 11   | `test/fixtures/jsp/`                                                                                      |
| O2    | Which anchors are stable enough for a page declaration?                                                                 | E2.6                         | after    | Översikt PR (`portal/pages.ts`, extractor, fingerprint); API reference rows                               |
| F1    | Does every browser-read page still have its anchors?                                                                    | E2.7                         | 18       | #25 E2.7                                                                                                  |
| F2    | Re-recorded fingerprints                                                                                                | E2.7                         | 19       | `src/providers/schoolsoft/portal/fingerprints.ts`                                                         |
| M1    | Do the 18 "assumed" rows of the field table hold (every typed read parses for every child)?                             | E4.6, typed-model spec       | 14       | typed-model spec provenance table; mappers in `portal/domain/` if drift                                   |
| M2    | Is a lesson id unique per occurrence?                                                                                   | typed-model spec             | 15       | same                                                                                                      |
| M3    | Does the lunch menu ever have weekdays 6–7?                                                                             | typed-model spec             | 15       | same                                                                                                      |
| M4    | Which year does SchoolSoft mean for a lunch week?                                                                       | typed-model spec             | —        | deferred: only visible around New Year (weeks 52–1)                                                       |
| V1    | First real `doctor --verify` counts and exit code                                                                       | E4.4, #49                    | 14       | the E4.6 PR; doctor-verify spec's live box                                                                |
| V2    | Does its report hold no data?                                                                                           | #49                          | 14       | same                                                                                                      |
| V3    | Is the child in focus unchanged after `--all-children`?                                                                 | #49                          | 14       | same                                                                                                      |
| L1    | Refresh-token lifetime: sliding or absolute?                                                                            | E8.1, #8                     | 35, 42   | session-longevity spec; #8                                                                                |
| L2    | Web-session idle timeout                                                                                                | E8.1, #8                     | 34, 35   | same                                                                                                      |
| L3    | Web-session absolute limit                                                                                              | E8.1, #8                     | after    | same (weeks of normal use)                                                                                |
| L4    | What does a dead web session answer on the header GET?                                                                  | E8.2, session-longevity spec | after    | same (with `SCHOOLSOFT_KEEPALIVE=all`)                                                                    |
| L5    | Does the keepalive touch extend the web session?                                                                        | E8.2, #8                     | after    | same                                                                                                      |
| L6    | One BankID, two sessions: do the OAuth login's cookies pass the GDPR gate?                                              | E8.3, #8                     | 7        | #8; E8.3                                                                                                  |
| L7    | Do a local login and the connector's login of the same guardian stay alive together? (added here)                       | derived from #54 and E2.2    | 22       | session-longevity and accounts-by-school specs                                                            |
| T1    | Is the slug the login boundary?                                                                                         | #54                          | 32       | accounts-by-school spec "Needs a live session"                                                            |
| T2    | Do two tenants' logins stay alive together?                                                                             | #54                          | 33       | same                                                                                                      |
| T3    | Do two tenants' web cookies collide in one browser?                                                                     | #54                          | —        | deferred to E3.4                                                                                          |
| T4    | Is the slug case-sensitive?                                                                                             | #54                          | 4        | same                                                                                                      |
| R1    | Reference page and REST surface against a real session                                                                  | #57, rest-surface spec       | 26       | reference-page and rest-surface specs' live boxes                                                         |
| R2    | Composite overview against a real session                                                                               | #60                          | 27       | composite-overview spec's live box                                                                        |
| R3    | Typed client against a deployment                                                                                       | #61                          | —        | deferred: needs the E11 app (E11.4)                                                                       |
| R4    | Native sign-in and consent flow                                                                                         | ROADMAP E11.5                | —        | deferred to E11.5 and E11.7                                                                               |
| W1    | Absence body, status, part-day, redirects, session                                                                      | #59                          | 38, 39   | = A1–A5                                                                                                   |
| W2    | Duplicate absence, leave application or booking: twice, replaced or refused?                                            | #59                          | 39       | write spec "Open questions"; absence = A6, leave and booking stay unknown                                 |
| W3    | Can the guardian undo each write?                                                                                       | #59                          | 36       | write spec                                                                                                |
| W4    | Does the portal list what was written, and how soon?                                                                    | #59                          | 36, 39   | write spec                                                                                                |
| W5    | Are leave, message and booking JSP-only, with a CSRF or one-time field?                                                 | #59                          | 11       | write spec; form fixtures (leave and message are captured; booking stays open)                            |
| W6    | What does a POST on an expired session get?                                                                             | #59                          | —        | not tested: it risks a duplicate real report; stays unknown                                               |
| W7    | How long does a write take?                                                                                             | #59                          | 38       | write spec (30-second timeout)                                                                            |
| W8    | Claude and ChatGPT, web and mobile: elicitation, `insufficient_scope` re-auth, `destructiveHint` prompt, "Always allow" | #59                          | 23–25    | write spec; the rest with a stub server, no BankID needed                                                 |
| W9    | Where can a live test message go?                                                                                       | #59                          | 36       | write spec                                                                                                |
| W10   | Does the portal limit writes separately?                                                                                | #59                          | 36       | write spec; not probed                                                                                    |
| B1    | How does SchoolSoft push back, and do the defaults ever meet it?                                                        | E6, request-budget spec      | all      | request-budget spec's live box                                                                            |

## Afterwards

- [ ] X1–X3, O1, K5, W5 → PR with the promoted fixtures and vocabulary additions; note on
      #25 E2.1.
- [ ] A1–A6 → PR correcting `toAbsenceNoticeBody`, its test, the absence spec's assumed
      column and the API reference row → closes **E2.4**, unblocks **E7.2** (the
      `report_absence` declaration: payload, `session`, `repeat`, redirect reading).
- [ ] O1, O2 → PR declaring Översikt (`portal/pages.ts`, extractor, fixture) → **E2.6**; its
      fingerprint at the next `make fingerprints`.
- [ ] F1, F2 → PR with the re-recorded fingerprints → **E2.7**.
- [ ] C1–C10, P1, P2, H1–H5 → PR updating `connector.md` (acceptance section and
      release-candidate note), the hops table, `cloudflare.md`, `render.yaml`,
      `compose.cloudflare.yaml`, `hostinger.md`, `chatgpt.md` and the support matrix →
      **E2.2**, **E2.3**; comment on #58. C11 after the E8.1 window, then tick E2.2.
- [ ] K1–K4 → PR on the calendar notes (and a fix if the end date is exclusive) → **E2.5**.
- [ ] M1–M3, V1–V3 → PR updating the typed-model table (and mappers on drift), with the
      verify counts → **E4.6** (#27). M4 in January.
- [ ] L2, L6, L7 → comment on #8 → **E8.1**, **E8.3**. L1, L3 after the checks in step 42;
      L4, L5 → **E8.2**; then **E8.4**.
- [ ] T1, T2, T4 → accounts-by-school spec table → **E3.4**.
- [ ] R1, R2 → live boxes in the reference-page, rest-surface and composite-overview specs
      → **E5.3**, **E5.6**. R3, R4 → **E11.4**, **E11.5**, **E11.7**.
- [ ] W2–W4, W6, W7, W9, W10 → the write spec's open-question table → **E7.2**, **E7.3**
      (leave: W2, W3, W5), **E7.4** (message: W5, W9), **E7.5** (bookings: W2, W3).
- [ ] W8 → a stub MCP server with a destructive tool, elicitation and a missing scope,
      tried in Claude and ChatGPT on web and phone (no SchoolSoft, no BankID) → **E7.6**,
      **E11.5**.
- [ ] B1 → request-budget spec's live box → **E6** (#29).
- [ ] Tick the stories on #25 and #27; update the roadmap's E2 row.
- [ ] Delete `.captures/` once the follow-ups have merged.

## Appendix: overview check

In the developer console of a connected `/reference/` tab. It spends the page's refresh
token and stores the new one, so the page keeps working. It prints statuses only.

```js
const key = "schoolsoft-reference";
const s = JSON.parse(sessionStorage.getItem(key));
const t = await (
  await fetch(s.client.endpoints.token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: s.refresh,
      client_id: s.client.id,
      resource: s.client.endpoints.resource,
    }),
  })
).json();
sessionStorage.setItem(key, JSON.stringify({ ...s, refresh: t.refresh_token }));
const auth = { headers: { Authorization: `Bearer ${t.access_token}` } };
const { children } = await (await fetch("/api/v1/children", auth)).json();
for (const round of ["cold", "warm"]) {
  const r = await fetch(`/api/v1/children/${children[0].id}/overview`, auth);
  const b = await r.json();
  console.log(
    round,
    r.status,
    b.week?.year,
    b.week?.week,
    b.schedule?.status,
    b.lunch?.status,
    b.nextEvent?.status,
  );
}
```

[Development](README.md) · [All documentation](../README.md)
