# SchoolSoft's unofficial API, as used by this project

SchoolSoft is a trademark of SchoolSoft AB; this document describes observed behaviour of their unofficial API for an independent project SchoolSoft AB is not involved in. Everything here was verified live against a Täby kommun guardian account on 2026-09-06. SchoolSoft can change any of it without notice; the live E2E suite is the canary.

Base URL for a tenant: `https://sms.schoolsoft.se/<slug>/`. The slug is the municipality or school-group tenant (`taby`), not the individual school; schools inside a tenant are `orgId`s.

## Is any of this official?

No. SchoolSoft publishes no API for guardians or students. Its only documented
integration is [SS12000](https://github.com/skolverket/dnp-ss12000-reference-api),
the Swedish standard for exchanging school data between organisations' systems;
SchoolSoft enables it per organisation on request (see e.g.
[Skolon's note](https://support.skolon.com/sv/kb/articles/schoolsoft)). It carries
provisioning data for administrators, not a parent's view of their child, so it
cannot serve this project.

Everything below is the private backend of SchoolSoft's own apps, learned by
observing them, exactly as every community client does
([ssp-node](https://github.com/elias4044/ssp-node),
[SchoolSoft+ Developer](https://developer.ssp.elias4044.com/),
[better-schoolsoft](https://github.com/sebdanielsson/better-schoolsoft)). It can
change without notice; the live E2E suite is the canary. One external
confirmation of the key finding: Google Play lists the guardian app as
`com.schoolsoft.vapp` ("SchoolSoft Vårdnadshavare"), matching the `vApp`
client id that mints guardian tokens.

## Discovery

| Endpoint                                                                        | Auth | Purpose                                                                                                                                      |
| ------------------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /internal/rest-api/login/schoollist`                                       | none | All ~3400 schools: `{ name, orgId, evaUrl }`. Slug is the first path segment of `evaUrl`. Cached 24 h by `find_school`.                      |
| `GET /<slug>/rest-api/login/methods/?client_id=<id>&usertype=<parent\|student>` | none | Enabled login methods: `3` SAML, `4` app username/password, `11` BankID direct. Täby: SAML + password only; BankID arrives via the SAML IdP. |
| `GET /<slug>/rest-api/login/discovery/document`                                 | none | Always points at the student login route; ignore it.                                                                                         |

## Login (OAuth 2 + PKCE)

| Step       | Request                                                                                                                                                                  | Notes                                                                                                                                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authorize  | `https://sms.schoolsoft.se/<slug>/react/#/login/<userType>?client_id=<vApp\|eApp>&code_challenge=…&code_challenge_method=S256&redirect_uri=…&state=…&response_type=code` | React SPA. Route must be `parent` for guardians. **`client_id` decides the token's `user_type`**: `vApp` → PARENT, `eApp` → STUDENT. A localhost `redirect_uri` is accepted. `orgid` is ignored for SAML/BankID. |
| SAML start | `GET /<slug>/rest-api/login/<userType>/saml?state&client_id&redirect_uri&lang…`                                                                                          | Redirects to the municipality IdP (Täby: `etjanst.taby.se/wa/auth/saml`), where BankID happens. Shibboleth state cookie records the return path.                                                                 |
| Token      | `POST /<slug>/rest-api/login/token?clientId=<id>&grantType=code&code=…&codeVerifier=…`                                                                                   | Returns `{ access_token (JWT), refresh_token }`. No `expires` field; use the JWT `exp` (15 min). Any `clientId` string is accepted here; only the authorize step's client id matters.                            |
| Refresh    | `POST /<slug>/rest-api/login/token?clientId=<id>&grantType=refresh_token&refreshToken=…`                                                                                 | Rotates the refresh token. Lifetime of the refresh token: unknown (tracked by the E2E snapshot). A wrong-typed token fails here with `Vi kunde inte hitta användaren`.                                           |

JWT claims: `sub` (UUID from `https://schoolsoft.se/core/login`, not a user id), `aud: https://schoolsoft.se/eva-backend`, `user_type`, `login_method` (`SAML`), `client_id`, `iat`, `exp`.

## Eva API (Bearer token)

The native app's backend. Header: `Authorization: Bearer <access_token>`.

| Endpoint                                                                                         | Returns                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /<slug>/eva/api/v1/parent`                                                                  | `{ guid, userId, firstName, lastName, children: [{ studentId, firstName, lastName, picture, guid, schools: [{ orgId, name, className }], username }] }` |
| `GET /<slug>/eva/api/v1/schools/<orgId>/lunchmenu/<week>`                                        | `[{ week, dayId (Mon=1…Fri=5), dishes: [{ mealType, description }] }]`                                                                                  |
| `GET /<slug>/eva/api/v2/parent/<userId>/schools/<orgId>/news?studentId=<sid>&langId=1`           | `[{ id, title, description, category, author, read, hasAttachment, creDate, toDate, newsConfirm }]`                                                     |
| `GET /<slug>/eva/api/v1/parent/<userId>/schools/<orgId>/messages/inbox`                          | `[{ id, subject, message (preview), isRead, sender{id, firstName, lastName}, date, hasFiles }]`                                                         |
| `GET /<slug>/eva/api/v1/parent/<userId>/schools/<orgId>/messages/<id>`                           | full message with recipients and attachments                                                                                                            |
| `GET /<slug>/eva/api/v1/parent/<userId>/schools/<orgId>/news/calendarevent/next?studentId=<sid>` | next calendar event or `null`                                                                                                                           |

Known 404s (do not exist for guardians): `/eva/api/v1/schools/<orgId>/student/<sid>/lessons`, `/eva/api/v1/schools/<orgId>/parents/<userId>/badge`.

More endpoints (holistic assessments, plannings, staff, profile updates) are catalogued in [sebdanielsson/better-schoolsoft](https://github.com/sebdanielsson/better-schoolsoft). That project is where the guardian header set and the Eva paths were first read before being verified here; no code from it is used.

## Webview REST (session cookies)

The React web app's backend. Needs `JSESSIONID`, `hash` and `usertype` cookies, obtained by the exchange below. The cookie session is bound to one child.

| Endpoint                                                                                                                                                                  | Notes                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /<slug>/eva-apps/auth/login/<userType>` with headers `token: <access_token>`, `userId`, `orgId`, `childInFocus`, `userOS: android`, `language: sw`, `redirecturl: …` | 303 with `Set-Cookie: JSESSIONID, hash, usertype, clientType`. Without `userId`/`orgId`/`childInFocus` it 303s to `…?error=other` with no cookies. |
| `GET /<slug>/rest-api/session`                                                                                                                                            | `{ app, organization{id,name}, userType{id: 2, name}, user{…}, language, theme, … }`. Used to verify a session.                                    |
| `GET /<slug>/rest-api/parent/calendar/lessons/week/<week>`                                                                                                                | `[{ eventId, name, description, startDate, endDate, room, teachingGroup, teacher, dayId, category: "lesson", … }]` for the child in focus          |
| `GET /<slug>/rest-api/parent/ps/assignments/start-page?week=<w>&year=<y>`                                                                                                 | `[{ id, activityId, title, subTitle, read, submissionStatus, resultReportStatus, sortDate }]`                                                      |
| `GET /<slug>/rest-api/parent/ps/assignments/<id>/view` and `/sections`                                                                                                    | assignment detail                                                                                                                                  |

## GUI coverage: what a guardian sees vs. what the APIs expose

Observed 2026-09-06 on Täby with an app-derived cookie session, read-only
(GET, redirects never followed, no forms submitted). The parent web GUI is
the legacy JSP application under `/jsp/student/` (the parent role shares
the student pages); several pages embed React views. Three tiers, plus a
GDPR gate:

| Menu item (sv)          | Page                                                                                                                                 | With our session                      | Tier / API                                                                                                               | Provider in this project                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| Startsida               | `right_student_startpage.jsp`                                                                                                        | 200                                   | JSP (embeds React)                                                                                                       | —                                                        |
| Aktuellt / Nyheter      | `right_student_news.jsp`                                                                                                             | 200                                   | JSP; news also via Eva `news`                                                                                            | api (Eva news)                                           |
| Kalender                | `right_student_week_calendar.jsp`                                                                                                    | 200                                   | JSP + React `#/parent/calendar`; REST `/rest-api/parent/calendar/lessons/week/{w}`, `/calendar/settings`                 | api (REST calendar)                                      |
| Verksamhetslogg         | `right_student_blogpost.jsp`                                                                                                         | 200                                   | JSP only                                                                                                                 | api (`POST /rest/blogpost/getbyloggedinuser`, read-only) |
| Matsedel                | React `#/student/lunchmenu`                                                                                                          | —                                     | Eva `lunchmenu`                                                                                                          | api (Eva lunch)                                          |
| Bokningar               | `right_student_timebooking.jsp`                                                                                                      | 200                                   | JSP only (booking = form post)                                                                                           | browser (`get_bookings`)                                 |
| Meddelanden             | `right_student_message.jsp`                                                                                                          | 200, 2 POST forms                     | JSP; inbox also via Eva `messages`; **send = form post**                                                                 | api (Eva inbox); send: not yet                           |
| Scheman / Provschema    | `right_student_schedule.jsp`, `right_student_test_schedule.jsp`                                                                      | 200                                   | JSP; lessons also via REST calendar                                                                                      | api (REST calendar)                                      |
| Kontaktlistor           | `right_student_class.jsp`                                                                                                            | 200                                   | JSP only                                                                                                                 | browser (`get_contacts`)                                 |
| Ämne (subject rooms)    | `right_student_subject.jsp` (menu) · React `#/parent/subjectrooms` → `/rest-api/parent/ps/subjectroom/all`, `/{activityId}/teachers` | 200                                   | webview REST (app session); the JSP menu is only read for the criteria page's `requestid` (differs from `activityId`)    | api (`get_subject_rooms`)                                |
| Planeringar & uppgifter | `right_student_planning.jsp`                                                                                                         | 302 → React error                     | REST `/rest-api/parent/ps/planning_parts/start-page`, `/ps/assignments/start-page`                                       | api (REST ps)                                            |
| Uppgifter & resultat    | `right_student_test.jsp`                                                                                                             | 200                                   | JSP; assignments via REST `ps/assignments`                                                                               | api (REST ps assignments)                                |
| Forum                   | `right_student_forum_list.jsp`                                                                                                       | 302 → React error                     | unknown                                                                                                                  | —                                                        |
| Frånvaroanmälan         | `right_student_absence.jsp`                                                                                                          | 200, 4 POST forms                     | JSP form post; REST `POST /rest-api/parent/absence-notice` also exists (GET → 405)                                       | not yet (write spec)                                     |
| Ledighetsansökan        | `right_student_studentleave.jsp`                                                                                                     | 200, 1 POST form                      | JSP form post                                                                                                            | not yet (write spec)                                     |
| Mina tider (fritids)    | `right_parent_preschool_schedule_new.jsp`                                                                                            | 200, 1 POST form                      | JSP form post                                                                                                            | not yet                                                  |
| Alla filer & länkar     | `right_student_library.jsp`                                                                                                          | 200                                   | JSP only                                                                                                                 | browser (`get_files`)                                    |
| Betyg                   | `right_student_gradesubject.jsp`                                                                                                     | 302 → `right_student_app_blocked.jsp` | **GDPR gate** (see below); 200 with a web-login session                                                                  | browser + web session (`get_grades`)                     |
| Elevdokument            | `right_student_review.jsp`                                                                                                           | 302 → gate                            | GDPR gate; web session: `table.longlist` "Rubrik / Skapad av / Datum", rows link to `?action=view&archive=1&requestid=N` | browser + web session (`get_student_documents`)          |
| Oanmäld frånvaro        | `right_parent_absence_message.jsp`                                                                                                   | 302 → gate                            | GDPR gate; web session: alert message or a list                                                                          | browser + web session (`get_unreported_absence`)         |
| Rapport (närvaro)       | `right_student_absence_student.jsp`                                                                                                  | 302 → gate                            | GDPR gate; web session: summary table + a POST filter form (weekFROM/weekTO, never submitted)                            | browser + web session (`get_attendance_report`)          |
| Kriterier               | `right_student_ability.jsp?subject=ID&schooltype=7`                                                                                  | 302 → gate                            | GDPR gate; web session: ability matrix per subject (`subject` = `requestid` from Ämne)                                   | browser + web session (`get_assessment_criteria`)        |
| Avstämning              | `right_student_gradeprognosis.jsp` → React, fetches `/rest-api/parent/gradeprognosis/options/reconciliationdates`                    | 302 → gate                            | GDPR gate; the REST call answers with the web-session cookies                                                            | api + web session (`get_grade_prognosis`)                |
| Översikt                | `right_student_lesson_status.jsp`                                                                                                    | 302 → gate                            | GDPR gate                                                                                                                | not yet                                                  |

Also live: `/rest-api/parent/holistic_assessment/rows`, `/rest-api/parent/nationaltests`,
Eva `/eva/api/v1/parent/{uid}/profile` (contains the guardian's personal data).

Consequences:

- JSON where it exists (Eva, webview REST incl. the subject-room endpoints
  behind the React "Ämne" view, one legacy `/rest` read-only POST for the
  activity log). Contact lists, bookings and files are read through the
  headless browser provider (see the Provider column and
  `docs/architecture.md`, "Portal adapter").
- **Page structure is declared once** (`src/core/portal/pages.ts`: path,
  gate, anchors). `schoolsoft-agent browser verify` and the live structure
  suite check the anchors and compare each page's structural fingerprint
  (hash of its tag/id/class skeleton, recorded by `make fingerprints`), so a
  SchoolSoft redesign shows up as named drift, page by page.
- **Write operations** exist as JSP form posts (absence, leave, fritids
  times, messages, bookings) and, for absence, as a React REST endpoint.
  Mapping them means reading each form's fields; none were submitted here.
- **Grades, student documents, absence and criteria are behind the GDPR
  gate** ("requires a login to be shown, log in again"): SchoolSoft refuses
  them to any app-derived session. `schoolsoft-agent login --web` opens the
  normal web login in a headed browser (the user does BankID as usual) and
  keeps that browser's cookies as a second, encrypted session. Gated pages
  are then read through the browser provider with those cookies, and the
  Avstämning REST call with the same cookie header. The web session is
  independent of the API token session and expires on inactivity; the
  errors say when to run `login --web` again.
- **The web session has its own child in focus**, separate from the app
  session's `childInFocus`. `GET /rest-api/parent/header/parent` (web
  cookies) returns `{ children[], currentChildId, currentOrgId }`; the
  portal's child menu switches with
  `PUT /rest-api/parent/header/parent?childId=N&orgId=M` (no body). Gated
  reads align the web child with the requested `child_id` first; that PUT
  is the only non-GET the web session ever sends, and it changes session
  state only. Non-gated browser pages keep using the app cookies, whose
  child in focus the API session controls.
- Loading `Login.jsp` (e.g. via the tenant root) invalidates the cookie
  session; probes must never follow redirects.

## What ssp-node gets wrong for guardians

`@elias4044/ssp-node` is a student client. It hardcodes the `student` login route, the `eApp` client id, the student cookie-exchange path, and sends none of the guardian headers. This project keeps it only for its HTTP helpers (`schoolsoftFetch`, `ssUrl`, `extractCookie`) and as the in-memory token/cookie holder.

## Error strings worth recognising

| Text                                                            | Meaning                                                                                                                        |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `Vi kunde inte hitta användaren … inte aktiv på den här skolan` | The identity resolved as the wrong user type (student route or `eApp` client id), or the account is not active at that tenant. |
| `Ingen aktiv inloggnings-session` (token endpoint, 404)         | The code is invalid or already used.                                                                                           |
| 303 to `…?error=other` from the exchange                        | Missing or wrong `userId`/`orgId`/`childInFocus` headers, or a dead token.                                                     |
