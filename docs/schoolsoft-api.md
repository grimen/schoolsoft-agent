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

More endpoints (holistic assessments, plannings, staff, profile updates) are catalogued in [sebdanielsson/better-schoolsoft](https://github.com/sebdanielsson/better-schoolsoft).

## Webview REST (session cookies)

The React web app's backend. Needs `JSESSIONID`, `hash` and `usertype` cookies, obtained by the exchange below. The cookie session is bound to one child.

| Endpoint                                                                                                                                                                  | Notes                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /<slug>/eva-apps/auth/login/<userType>` with headers `token: <access_token>`, `userId`, `orgId`, `childInFocus`, `userOS: android`, `language: sw`, `redirecturl: …` | 303 with `Set-Cookie: JSESSIONID, hash, usertype, clientType`. Without `userId`/`orgId`/`childInFocus` it 303s to `…?error=other` with no cookies. |
| `GET /<slug>/rest-api/session`                                                                                                                                            | `{ app, organization{id,name}, userType{id: 2, name}, user{…}, language, theme, … }`. Used to verify a session.                                    |
| `GET /<slug>/rest-api/parent/calendar/lessons/week/<week>`                                                                                                                | `[{ eventId, name, description, startDate, endDate, room, teachingGroup, teacher, dayId, category: "lesson", … }]` for the child in focus          |
| `GET /<slug>/rest-api/parent/ps/assignments/start-page?week=<w>&year=<y>`                                                                                                 | `[{ id, activityId, title, subTitle, read, submissionStatus, resultReportStatus, sortDate }]`                                                      |
| `GET /<slug>/rest-api/parent/ps/assignments/<id>/view` and `/sections`                                                                                                    | assignment detail                                                                                                                                  |

## What ssp-node gets wrong for guardians

`@elias4044/ssp-node` is a student client. It hardcodes the `student` login route, the `eApp` client id, the student cookie-exchange path, and sends none of the guardian headers. This project keeps it only for its HTTP helpers (`schoolsoftFetch`, `ssUrl`, `extractCookie`) and as the in-memory token/cookie holder.

## Error strings worth recognising

| Text                                                            | Meaning                                                                                                                        |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `Vi kunde inte hitta användaren … inte aktiv på den här skolan` | The identity resolved as the wrong user type (student route or `eApp` client id), or the account is not active at that tenant. |
| `Ingen aktiv inloggnings-session` (token endpoint, 404)         | The code is invalid or already used.                                                                                           |
| 303 to `…?error=other` from the exchange                        | Missing or wrong `userId`/`orgId`/`childInFocus` headers, or a dead token.                                                     |
