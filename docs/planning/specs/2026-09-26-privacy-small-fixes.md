---
title: Privacy small fixes
type: fix
created: 2026-09-26
status: in-review
route: dispatch
context:
  - AGENTS.md
  - docs/getting-started/data-handling.md
  - docs/planning/specs/2026-09-26-versioned-state.md
  - docs/planning/specs/2026-09-26-accounts-by-school.md
  - https://github.com/grimen/schoolsoft-agent/issues/64
---

# Privacy small fixes (E10.4)

Writing the data-handling statement (#62) found four places where the files on disk hold more, or are less protected, than they need to be. This fixes them in one change. The rest of #64 (other families' data, "disconnect everything", the keychain, stderr lines, doc errors and links) is out of scope.

<frozen-after-approval>

## 1. Local session history is encrypted

`<stateDir>/session-history.json` (plaintext) becomes `<stateDir>/session-history.enc`, sealed like `session.enc`: AES-256-GCM with the state directory's `key.bin`, `iv | tag | ciphertext`, the file name as associated data (so a file cannot be swapped for another sealed file). The document inside is the same history format, `HISTORY_FORMAT` v2, with its version inside the encrypted payload, as in the connector's `history.enc`.

The file name changes on purpose. An older build that found an encrypted `session-history.json` would read it as corrupt and write a fresh plaintext history over it; with a new name it never touches the encrypted file.

| On disk | Read | Next write |
| --- | --- | --- |
| only `.json` (v0 to v2) | migrated as today | writes `.enc`, then deletes `.json` |
| only `.json`, newer than this build | `NewerFormatError`, file untouched | none (writes read first) |
| `.enc` | the `.enc`; a `.json` next to it is ignored | writes `.enc`, then deletes the stray `.json` |
| `.enc`, newer than this build | `NewerFormatError`, file untouched | none |
| `.enc` unreadable (tampered, key lost) | empty history, as a corrupt `.json` today | a fresh `.enc` |

The plaintext file is deleted only after the encrypted one has been written and renamed into place. No build newer than this one writes `.json`, so a `.json` next to an `.enc` comes from an older build run after an upgrade; its few events are dropped. `doctor` reports the version of whichever file is read.

## 2. `login-pending.json`: encrypted locally, gone from the connector

The marker needs what it holds: the login URL is what `login --background` returns from a detached process (a stable output), and the failure text is what `auth_status` reports. So it is not reduced. Instead:

- **Locally** it becomes `<stateDir>/login-pending.enc`, sealed with `key.bin` like the history. It stays unversioned: it lives at most six minutes, and anything unreadable already reads as "no login running". A `login-pending.json` left by an older build is deleted on the next write or clear of the marker.
- **On the connector** it is not written at all. The connector is one process that tracks its own login in memory (`ConnectorRuntime`) and never reads the marker, so its session manager gets the in-memory store.

It stays shared, not per account (E3.2): the callback port (`SCHOOLSOFT_CALLBACK_PORT`) and the user's browser are one per computer, so a second BankID login must wait whatever the school. The connector has one account.

## 3. Every file and directory is written through one helper

`src/core/private-files.ts`: directories are created 0700, files are written 0600 to a temporary file in the same directory and renamed into place (a reader never sees half a file, and a file created earlier with wider permissions is replaced rather than reused). `key.bin` is created exclusively, so two processes starting at once agree on one key. The connector's storage passes `durable` (flush the file, then the directory). The host probe's log appends through it too.

Writers moved onto it: `config.json`, `schools.json` (and the config directory when the school search creates it first), `session.enc`, `key.bin`, the history, the pending marker, `doctor --fix`'s state directory, the connector's `.enc` files and the probe log. A boundary test fails when any other module under `src/` imports a file-creating `node:fs` function; the only exception is the fixture promotion tool, which writes test fixtures into the repository, not user state. A unit test runs every writer against an empty directory and asserts the mode of everything it created. On Windows the modes are ignored and the user profile's permissions apply, as before.

## 4. Pending-consent requests no longer store the network address

The pending-consent flood protection (E9.3) needs one thing from the address: whether two waiting requests come from the same network (`clientKey`: IPv4, or IPv6 /64). It never needs the address itself. So `oauth.enc` now stores a keyed pseudonym, `HMAC-SHA256(k, clientKey(ip))`, where `k` is random per process and never written anywhere. Within a process, equal networks give equal pseudonyms, so the per-requester cap and "the largest holder loses its oldest request" work as before. The address is held only while the authorization request is handled. On disk nothing can turn the pseudonym back into an address, even with the storage key, because `k` dies with the process.

The pseudonym goes with its request: at once when the request is approved or denied (as today), and at the next clean-up after it expires. After a restart, the requests restored from disk keep their old pseudonyms, which no longer match anyone. For the remaining minutes of those requests, one network can hold its share again under its new pseudonym. The overall cap still holds. A pending request written by an older build still holds a plain address. On start, each such address is replaced by its pseudonym and the file is rewritten.

`OAUTH_STATE_FORMAT` stays v1: the field is still a string, so older builds read the new file.

</frozen-after-approval>

## Compatibility

- `session-history.enc` and `login-pending.enc` are new files with migrations from the old ones: not a breaking change under the stability policy. The downgrade is the one exception to "an older build refuses a newer file": an older build does not know the new names, so it neither refuses nor overwrites them. It starts an empty plaintext history (lifetimes only), which this build later drops. Saved sessions, settings and the connector's files are unaffected.
- `oauth.enc` keeps its version; older connector builds read it.

## Tasks & Acceptance

- [ ] History: plaintext v0/v1/v2 migrates to `.enc` on the next event and the `.json` is deleted only after the write; a newer `.json` or `.enc` is refused and left byte for byte; a failed write keeps the `.json`; the `.enc` holds no plaintext.
- [ ] Pending marker: sealed, legacy `.json` removed, connector writes no marker.
- [ ] Every writer creates 0700 directories and 0600 files; the boundary scan catches a new writer.
- [ ] `oauth.enc` never contains an address; flood protection behaves as before; restored addresses are replaced.
- [ ] Data-handling, architecture and stability pages match.

## Verification

See the pull request for the gate results.
