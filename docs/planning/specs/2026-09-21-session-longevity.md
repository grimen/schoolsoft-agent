---
title: Session longevity, offline half
type: feature
created: 2026-09-21
status: in-review
route: dispatch
baseline_commit: 50aed5fd57250a7ad1dc928c1280cf53a118d3ca
context:
  - AGENTS.md
  - docs/development/architecture.md
  - docs/reference/schoolsoft-api.md
  - https://github.com/grimen/schoolsoft-agent/issues/8
---

# Session longevity: fewer BankID logins (offline half)

Issue #8 asks how a parent can do BankID rarely. Half of the answer needs a live guardian session and days of waiting; the other half is ordinary code that the injected clock, store and fetch can prove. This spec covers the second half only.

<frozen-after-approval>

## Intent

A non-technical parent meets a forced BankID login as seldom as SchoolSoft's own limits allow, and when one does happen the tool can say how long the session lasted. Nothing here automates BankID, and nothing here was tried against SchoolSoft.

## Built in this change

1. **Measurement.** Every login, token refresh, web-session use and session loss is recorded with a timestamp in a small history file in the state directory. A loss records which session died, how old it was and how long it had been idle. `auth_status` and `doctor` summarise it, so after a few weeks of ordinary use the observed lifetimes can be read off. The record holds no tokens, no cookies, no child names or ids, and is bounded (300 events, 50 losses).
2. **Read cache.** An in-memory cache in front of the portal, keyed by provider, school, guardian, child, capability and normalised arguments, with a TTL per capability. Fewer requests means fewer chances to meet an expired session and less load on SchoolSoft. It is cleared on login, logout, child switch and session loss, bounded to 200 entries, bypassed with `fresh: true`, and never written to disk. GDPR-gated data is never cached.
3. **Durable app session.** A rotated refresh token is persisted the moment the provider reports it, before the profile lookup and cookie exchange that can still fail. A network failure or an HTTP 5xx during restore no longer deletes the saved session. Refresh and restore are serialised inside the session manager so two callers cannot spend the same refresh token.
4. **Opt-in keepalive.** Off by default. In a long-lived process (MCP server, HTTP connector) a scheduler refreshes the API token a few minutes before expiry and, when asked to, touches the web session with the one GET the portal's own header makes. Jitter, exponential backoff on transient failure, a hard stop on session loss, optional quiet hours. The one-shot CLI never starts it.

## Needs live measurement (not attempted here)

| Question | Why it cannot be answered offline | How the answer arrives |
| --- | --- | --- |
| Refresh-token lifetime; sliding or absolute | Needs days of real refreshes | `sessionHistory.app` and `losses` in `auth_status` after some weeks of use |
| Web session idle timeout and absolute limit | Needs a real web login left idle | `sessionHistory.web.longestGapSurvivedMinutes` against `losses[].idleMinutes` |
| What a dead web session answers on `GET /rest-api/parent/header/parent` | Only a live expired session shows it | A 401 was seen once (API reference, 2026-09-06). A 200 that is not the header JSON is assumed to mean the same. Both are treated as a lost web session; verify live |
| Two processes sharing one state directory refreshing at the same instant | Needs the marker-file coordination from issue #8 | Not built. Within one process restore and renew are serialised; renew adopts tokens another process already rotated, and a rejected renewal that finds newer tokens in the store keeps them instead of clearing the session. A cold restore losing the same race is not covered |
| Does the keepalive touch actually extend the web session | Server-side behaviour | Compare `losses[].idleMinutes` with and without `SCHOOLSOFT_KEEPALIVE=all` |
| One BankID, two sessions (issue #8 step 2) | Requires a real BankID login | Separate experiment by the maintainer; must never be automated |
| Eager fetch and encrypted cache of gated data (step 4) | Depends on the measured limits and on the outcome of step 2 | Decide after the numbers exist |
| OS scheduler for skill users (`keepalive install`) | Only useful if keepalive proves worthwhile | Later spec |

## Boundaries

- Never automate BankID. Keepalive calls `renew`, never `login`; a lost session stops the scheduler until a human logs in again.
- The web session's only non-GET stays the child-in-focus PUT. The keepalive touch is a GET and does not align the child.
- `src/core` owns the cache port, the TTL table, the history and the scheduler. Which URL is the harmless touch lives in `src/providers/schoolsoft/` behind `touchWebSession()` on the provider's API portal.
- Configuration arrives through `Config` (`SCHOOLSOFT_KEEPALIVE`, `SCHOOLSOFT_KEEPALIVE_WEB_MINUTES`, `SCHOOLSOFT_KEEPALIVE_QUIET_HOURS`, `SCHOOLSOFT_CACHE`, or the same keys in `config.json`); core reads no environment.
- Courtesy and independence: SchoolSoft AB is not involved in this project and has not approved background requests. Keepalive is opt-in, one small GET per interval (default 10 minutes, minimum 5), backs off when SchoolSoft struggles, and cannot beat a server-side absolute limit. A parent who never enables it sends SchoolSoft nothing they did not ask for.

## Cache policy

| Capability | TTL | Reason |
| --- | --- | --- |
| `getLunchWeek` | 6 h | Published weekly |
| `getSubjectRooms`, `getContacts` | 6 h | Change a few times a term; contacts cost a browser start |
| `getFiles` | 1 h | Rarely changes; costs a browser start |
| `getScheduleWeek`, `getCalendar` | 30 min | Substitutions happen during the day |
| `getNews`, `getAssignmentsWeek`, `getAssignmentDetail`, `getActivityLog` | 10 min | Feeds; a follow-up question in the same conversation is the common case |
| `getInbox`, `getMessage`, `getBookings` | never | Unread state and slot availability must be current |
| `getParent`, `getSession`, `getNextCalendarEvent` | never | They are how a dead session is noticed |
| every web-session capability (grades, documents, absence, attendance, criteria, prognosis) | never, enforced in code | SchoolSoft asks for a second login for these; holding them past that session would undo the gate, and each real read is a measurement |

## I/O and edge cases

| Input or condition | Required behaviour |
| --- | --- |
| Same capability and arguments, two children | Two entries; neither child ever receives the other's data, also when calls interleave |
| Child focus changes while a read is in flight | The result is returned but not stored |
| Login, logout, child switch, app session loss | Cache emptied |
| `fresh: true` | Upstream read; the cache entry is replaced |
| Entry older than its TTL | Upstream read |
| More than 200 entries | Least recently used entry dropped |
| Connector: app revoked or child not permitted, warm cache | Refused before the cache is consulted and again before release; no cached data leaves |
| Refresh succeeds, the following profile lookup fails | The rotated token is already on disk |
| Network error or HTTP 5xx during restore or renew | Saved session kept; no loss recorded |
| Refresh rejected | Store cleared, loss recorded with age and idle time, keepalive stops |
| Keepalive transient failure | Backoff doubles up to 60 minutes; success resets it |
| Keepalive during quiet hours | No request; next check one interval later |
| Web touch answers 401/403 or a non-header body | Web loss recorded, web task stops, app task continues |
| Login after a stop | The matching task starts again |
| CLI command | No scheduler is created |
| Invalid keepalive, interval, quiet-hours or cache value | `AgentError` (`config_value_invalid`) in English and Swedish |

</frozen-after-approval>

## Code Map

- `src/core/session/history.ts`: history record, recorder, file and memory stores, summary.
- `src/core/session/session-manager.ts`: events, `renew`, serialised restore, persist-on-refresh, transient errors keep the store.
- `src/core/cache/`: `ReadCache` port, `MemoryReadCache`, TTL policy.
- `src/core/portal/cached.ts`, `src/core/portal/observed.ts`: portal decorators for the cache and for web-session use and loss.
- `src/core/keepalive/scheduler.ts`: injected timer, clock and random.
- `src/core/operations/run.ts`: `runOperation` selects the fresh portal; operations declare `fresh` in their input.
- `src/core/wiring.ts`: defaults for all of the above; `createKeepalive`.
- `src/providers/schoolsoft/`: `renew` on the BankID strategy, `onRefresh`, `touchWebSession`.
- `src/mcp/keepalive.ts`, `src/http/runtime.ts`: the two long-lived hosts start it; the connector runs ticks through its serialised queue.

## Tasks & Acceptance

- [x] History. Given logins, refreshes, web reads and losses under an injected clock, when `auth_status` runs, then ages, idle times and the longest survived gap are reported and the file contains no credentials or child data.
- [x] Cache. Given two children and interleaved calls, when reads repeat, then each child gets only its own data; TTL, `fresh`, bounds and invalidation behave as in the table.
- [x] Connector. Given a warm cache, when an app is revoked or asks for a child it was not granted, then it receives an error and no cached data.
- [x] Durable refresh. Given a refresh followed by a failing profile lookup, when the process restarts, then the rotated token is used.
- [x] Keepalive. Given the injected timer, when tokens near expiry, sessions die, the network fails or quiet hours apply, then the scheduler behaves as in the table and never calls `login`.
- [x] Docs. Generated references, configuration, troubleshooting and architecture describe the behaviour in plain language.

## Verification

See the pull request for the gate results.
