---
title: Accounts keyed by school
type: feature
created: 2026-09-26
status: in-review
route: dispatch
baseline_commit: 29fccf5de87305e266b7e67e269e7d4ade8dbb12
context:
  - AGENTS.md
  - docs/development/architecture.md
  - docs/development/stability.md
  - docs/planning/specs/2026-09-26-versioned-state.md
  - docs/planning/specs/2026-09-21-session-longevity.md
  - https://github.com/grimen/schoolsoft-agent/issues/26
---

# Accounts keyed by school (E3.2)

The tool keeps one school in its configuration and one saved login in its state. A family with children in two municipalities, or in an independent school with its own SchoolSoft address, needs two logins. Today the second one replaces the first: pointing the tool at another school (`--school`, `SCHOOLSOFT_SCHOOL`) deletes the saved session of the configured one. This change makes the files on disk hold one entry per account, so two accounts can be stored side by side, while every surface still works with one. Choosing between accounts in the CLI, MCP and connector is E3.4. Built offline: no SchoolSoft login, no BankID round and no request to schoolsoft.se took place.

<frozen-after-approval>

## Intent

Every persisted file that holds something that belongs to one login stores it under the account it belongs to. Existing single-account files migrate on their next read through the versioned-state mechanism (E3.1) and are rewritten in the new shape on their next write. A file from a newer build is still refused. A parent who uses one school sees no difference.

## The account and its key

An account is one login to one school portal tenant: the provider and the school slug (`taby` in `https://sms.schoolsoft.se/taby/`). Its key is the string `<provider>:<school>`, for example `schoolsoft:taby`. The school is kept as given (no case folding), exactly as it is used in the portal's URLs today.

Why this key:

- **It is what a login is bound to.** The slug picks the tenant the BankID login, the tokens and the cookies belong to. One guardian login to a tenant already sees every child in it, also in different schools of that municipality (`GuardianContext.children[].schools[]`); a second municipality or an independent school with its own slug needs a second login. `orgId` picks a school inside a tenant and is a setting of the account, not a separate account.
- **It is known before a login.** The current account has to be found before anything is restored or saved: from `--school`, `SCHOOLSOFT_SCHOOL` or `config.json`, the same settings that choose the school today. The guardian's identity (`userId`) is only known after a login, so a key that contained it could not tell which saved session to restore without a second pointer.
- **It matches what already exists.** The read cache is keyed by provider, school, guardian and child; the connector pins `<provider>:<school>:<userId>`. The account key is that pin without the guardian.

Why not the guardian in the key: one state directory belongs to one person's operating-system account, and each parent runs their own copy. A different guardian who logs in to the same school replaces the saved session, as today. The connector keeps refusing a second guardian with its identity pin. Should two guardians ever share one state directory, the key can grow a guardian part in a later format with its own migration.

## What is persisted, and whether it is per account

| What | Where | Per account? | Why |
| --- | --- | --- | --- |
| Settings | `<configDir>/config.json` | the account settings (`provider`, `school`, `orgId`, `userType`, `clientId`) are; the rest are not | `orgId` goes into the login URL and `userType`/`clientId` choose the login route, so they belong to one tenant. Cache, keepalive, writes, request budget, browser, callback port and directories are settings of the machine and the process. |
| Saved session (tokens, cookies, guardian and children, web-login cookies) | local `<stateDir>/session.enc`; connector `session.enc` | yes | It is the login. |
| Session history (timestamps and counters) | local `<stateDir>/session-history.json`; connector `history.enc` | yes | Lifetimes are per login: a login, logout or loss for one account must not reset or end another's span. |
| Login in progress | `<stateDir>/login-pending.json` | no | One BankID login at a time: the callback port and the user's browser are shared, so a second login must wait whatever the account. Unversioned, lives minutes. |
| Public school list | `<configDir>/schools.json` | no | Public data, the same for everyone. Unversioned cache. |
| Encryption key | `<stateDir>/key.bin` | no | One key for the state directory; every account's session is in the file it protects. |
| Connector OAuth state (clients, consents, codes, grants, tokens) | connector `oauth.enc` | no, format unchanged (v1) | A connector serves one account by construction (one `SCHOOLSOFT_SCHOOL`, one pinned guardian). Grants name children by id, which is only unique inside a tenant; when the connector serves several accounts (E3.4) a grant needs the account too, and that is a new format of this file then. |
| Connector identity pin | connector `identity.enc` | no, format unchanged (v1) | It is the deployment's owner: `<provider>:<school>:<userId>`, which already contains the account key. |
| Read cache | memory only | already | Keyed by provider, school, guardian, child, capability and arguments; never on disk. |
| Request budget and circuit breaker | memory only | no | It protects the portal from this process, whichever account a request is for. |
| Keepalive schedule | memory only | per session manager | One manager per process today; E3.4 decides how several accounts share one scheduler. |
| Typed outputs, `doctor --verify` | nothing persisted | not applicable | |

## File shapes

### `config.json`: v1 → v2

v1 (today):

```json
{ "version": 1, "school": "taby", "orgId": "20", "keepalive": "app" }
```

v2:

```json
{
  "version": 2,
  "account": "schoolsoft:taby",
  "accounts": {
    "schoolsoft:taby": { "school": "taby", "orgId": "20" },
    "schoolsoft:vallentuna": { "school": "vallentuna" }
  },
  "keepalive": "app"
}
```

`account` is the current account; `accounts` holds each account's settings. Everything else stays at the top level. An entry stores `provider` only when it was set, as today; a missing provider is `schoolsoft`.

The migration moves the account settings of a document that names a `school` into `accounts` under that school's key and points `account` at it. Account settings without a `school` (the school came from the environment) stay at the top level, where they apply to whichever account is selected, as they do today.

The account settings stay valid `config.json` keys at the top level in every version (the [stability policy](../../development/stability.md#configuration) lists them as settings): a top-level `school` in a v2 file, written by hand, is folded in the same way on every read and becomes the current account. `configure` always writes the v2 shape.

### `session.enc` (local and connector): v1 → v2

v2 inside the encryption, as before:

```json
{ "version": 2, "accounts": { "schoolsoft:taby": { "provider": "schoolsoft", "school": "taby", "data": {}, "savedAt": 0, "authMethod": "bankid-browser" } } }
```

Each entry is today's `PersistedSession`, unchanged. The migration keys the single v1 session by its own provider (absent: `schoolsoft`) and school. A v1 session without a school cannot be keyed and is treated like a corrupt file: logged out. The v0 → v1 step (`migratePersisted`) stays in front of it.

### `session-history.json` (local) and `history.enc` (connector): v1 → v2

```json
{ "version": 2, "accounts": { "schoolsoft:taby": { "app": null, "web": null, "losses": [], "events": [] } } }
```

A v1 history does not say which school it was recorded for, and a migration sees only its own file. The migration therefore keeps it as `legacy`, and the first account that reads the history without an entry of its own sees the legacy record; the first such account that records an event stores it as its own and `legacy` is dropped. A single-account user's history thus stays theirs. Someone whose first command after the upgrade is for a different school sees the old counters under that school; the history holds timestamps and counters only, so that is a cosmetic misattribution, and it is documented rather than solved with a cross-file lookup.

## The current account

The current account is resolved from the settings, with the precedence that already exists (flags, then environment, then `config.json`, then defaults):

1. If `--school` or `SCHOOLSOFT_SCHOOL` (and optionally the provider) is given, the account is that school; its settings come from its `accounts` entry when there is one, and from nothing else in the file.
2. Otherwise it is the file's `account`, with its entry's settings.
3. Top-level settings apply in both cases, below the entry.

The resolved `Config` is unchanged in shape. `accountKeyOf(config)` gives the key, and `wiring.ts` opens the session store and the history store for that key. The session manager, the portals, the keepalive, the operations and every surface see one account's session store exactly as before.

`configure --school <slug>` adds or updates that account's entry and makes it current; other accounts stay. The entry starts from what that account already had, never from another account's settings.

## Rules (unchanged from E3.1, per file)

| Stored `version` | Behaviour |
| --- | --- |
| missing (v0) or 1 | migrated through every step to v2 in memory; the next write stores v2 |
| 2 | loaded |
| 3 or higher | `NewerFormatError` (exit 5, "update schoolsoft-agent"); the file is not read further, not overwritten, not deleted |
| malformed | the file's existing corrupted-file behaviour |

A v2 document whose `accounts` is not an object is treated as holding no accounts.

## Writing one account next to others

- **Save** re-reads the file, replaces that account's entry and writes the whole document, so another account's entry written by another process in the meantime is kept. A process that saves between that read and the write can still lose that one update; the window is two synchronous file calls, the same class of race the single-session file has today between a CLI and an MCP server.
- **Clear** (logout, a rejected session) removes that account's entry; when no entry is left, the file is deleted, so a single-account logout still leaves no `session.enc`, as today.
- An unreadable (corrupt) file is replaced on save, as today, which now logs out every account in it. A newer file is refused before any write.
- Switching the school no longer deletes the other school's session: the saved session of another account is simply not the current one.

## Upgrade, downgrade and stability

- Upgrade: silent. Files load as before and gain the v2 shape on their next write.
- Downgrade: a build from before this change finds `config.json`, `session.enc` or `session-history.json` at v2 and stops with the newer-version message, leaving the file alone. That is what E3.1 exists for: an older build that read v2 as v1 would find no `school` and no session, and the next `configure` or login would overwrite and lose the other account.
- Under the [stability policy](../../development/stability.md#persisted-state) a persisted format change with its migration is not breaking; the commit body says so, because it ends the way back. The settings keep their names and meaning (top-level keys still work). No `!`, no `BREAKING CHANGE:` footer.
- One observable correction, not a contract change: `--school other` or `SCHOOLSOFT_SCHOOL=other` no longer borrows `orgId`, `userType` or `clientId` from the configured school's settings, and no longer deletes that school's saved session. For a user of one school nothing changes.

## Design

- `src/core/accounts.ts` (pure): `accountKey`, `accountKeyOf`, the `AccountsDocument` helpers (`accountsOf`, `withAccount`, `withoutAccount`), the config fold and `accountSource` (the file's settings for a selection).
- `CONFIG_FORMAT`, `SESSION_FORMAT` and `HISTORY_FORMAT` each gain one migration; nothing else in `versioned.ts` changes.
- `FileSessionStore(dir, account)` and `FileSessionHistoryStore(dir, account)` implement the existing one-account ports for one key; both also list the stored accounts for `doctor`. `SessionStore`, `SessionHistoryStore` and `SessionManager` are unchanged (open/closed: the store decides where an account's entry lives, not the manager).
- The connector's store adapters in `src/http/start.ts` use the same helpers over `EncryptedRepository`, so one format per file kind still serves both hosts.
- `src/shared/bootstrap.ts` reads the selection from flags and environment before it asks the file for its settings. `configure` writes the account entry.
- `doctor` names the current account on the session line and says how many accounts are stored when there is more than one.

</frozen-after-approval>

## Needs a live session (E2)

| Question | Why it matters | How to answer it |
| --- | --- | --- |
| Is the slug the login boundary: does one login see children in every school of a municipality, and does an independent school with its own slug need its own login? | It is the premise of the key | A family with children in two schools, one `list_children` per login |
| Can two tenants' logins be held at the same time, or does a login or refresh at one end the other? Both use `sms.schoolsoft.se` | If one ends the other, two stored accounts still work but only one at a time stays alive | Log in to two schools, then refresh each and watch the session history |
| Do the web-login cookies of two tenants collide in the browser (same host, different paths)? | Each account stores its own cookies, but the headless browser may mix them if it ever holds both | E3.4, when one process serves two accounts |
| Is the slug case-sensitive at SchoolSoft? | The key keeps the slug as given; `Taby` and `taby` would be two accounts | One request with each spelling |

## Tasks & Acceptance

- [ ] Two accounts are stored side by side in `config.json`, `session.enc` and `session-history.json` (local) and in the connector's `session.enc` and `history.enc`, and a save, refresh, loss or logout of one leaves the other exactly as it was.
- [ ] A v0 and a v1 file of each kind (fixtures in the old shapes) loads as the account it belongs to and is written back as v2 on the next write.
- [ ] A file at v3 is refused with the newer-version message in both languages and left byte-for-byte unchanged.
- [ ] A single-account user sees the same results: configure, login, restore, refresh, logout (no `session.enc` left), doctor, auth status, connector restart.
- [ ] Switching `--school` keeps the other school's session and does not borrow its `orgId`.
- [ ] Architecture, troubleshooting and connector pages describe it in plain language.

## Verification

See the pull request for the gate results.
