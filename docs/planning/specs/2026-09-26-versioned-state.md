---
title: Versioned state and config
type: feature
created: 2026-09-26
status: in-review
route: dispatch
baseline_commit: 221f285ec6266e44f7797c9f946cef491da6e64d
context:
  - AGENTS.md
  - docs/development/architecture.md
  - https://github.com/grimen/schoolsoft-agent/issues/26
---

# Versioned state and config (E3.1)

Nothing is published yet. Once it is, every change to a file the tool keeps on disk becomes a migration for every user. This change makes each persisted file say which format it is in, so later changes can be migrated instead of guessed at, and so an older build never misreads or overwrites a file written by a newer one.

<frozen-after-approval>

## Intent

Every persisted JSON document carries a whole-number `version`. A file without one is today's format (v0) and loads as before; the next write stores the current version. A file from a newer build is refused with a message telling the user to update, and is left exactly as it is.

## Files

| File | Loader | Current | Where the version lives | v0 → v1 |
| --- | --- | --- | --- | --- |
| `<configDir>/config.json` | `src/shared/bootstrap.ts` (`fileSource`, `readConfigFile`; written by `configure`) | 1 | top-level field | nothing changes but the field |
| `<stateDir>/session.enc` | `FileSessionStore` (`src/core/session/file-store.ts`) | 1 | top-level field of the decrypted JSON | `migratePersisted` (the existing pre-provider-seam fold) |
| `<stateDir>/session-history.json` | `FileSessionHistoryStore` (`src/core/session/history.ts`) | 1 | top-level field (already written as `version: 1`) | nothing changes but the field |
| connector `session.enc` | `EncryptedRepository` (`src/http/storage.ts`) with the session format | 1 | inside the encrypted payload | as the local session |
| connector `history.enc` | same, history format | 1 | inside the payload (already `version: 1`) | as the local history |
| connector `oauth.enc` | same, `OAUTH_STATE_FORMAT` (`src/http/oauth.ts`) | 1 | inside the payload | nothing changes but the field |
| connector `identity.enc` | same, `IDENTITY_FORMAT` (`src/http/start.ts`) | 1 | inside the payload | a bare JSON string becomes `{ "identity": … }` |

Not versioned, on purpose:

- `login-pending.json`: a marker between processes that lives at most six minutes (`PENDING_LOGIN_TTL_MS`) and is removed by every finished login. An unreadable marker already reads as "no login running". Refusing to start because of a stale marker from another build would block logins for no gain.
- `schools.json`: a cache of SchoolSoft's public school list. An unexpected shape already reads as "no cache" and is fetched again.
- `key.bin`: 32 raw key bytes, not a document. A different key scheme would be a new `session.enc` format and go through that file's version.

### Inside the payload, not in the envelope

The connector's `EncryptedRepository` stores `iv | tag | ciphertext` with the file name as associated data. The version goes inside the encrypted JSON because:

- what changes over time is the document schema, not the cipher; the session and history documents are the same formats as the local files, so one registry and one migration per format serve both stores;
- inside the payload the version is covered by the GCM tag: nobody with disk access can flip it to make an older or newer build misread the rest;
- the envelope has exactly one form today. If the cipher ever changes, the new envelope can be told apart by its own marker; it does not need a field reserved now.

## Rules (every file kind)

| Stored `version` | Behaviour |
| --- | --- |
| missing | v0: migrated in memory through every registered step; the next write stores the current version |
| whole number ≤ current | migrated from that version and loaded |
| whole number > current | `NewerFormatError`: the file is not read further, not overwritten, not deleted |
| anything else (string, negative, fraction, null) | the file's existing corrupted-file behaviour: session and history read as absent (logged out, empty history); `config.json` is the existing "Could not parse" error; connector data stays fail-closed ("Stored connector data cannot be read") |

No other change to current files: the only difference on disk is the added field.

The local session store checks the stored version before `save` and `clear` too, because a CLI and an MCP server of different builds can share one state directory and `save` does not read first. The history file and `config.json` are always read before they are written, so the read already refuses. The connector reads every repository at startup, so a newer file stops it from starting.

## The error

`NewerFormatError` is an `AgentError` of kind `not_available` (exit code 5), message key `state_newer_than_app`, hint `update_app`, in English and Swedish. `not_available` already means "this build cannot do it here; install or upgrade something" (`browser_required` with `browser_install`). The other kinds lead somewhere harmful or wrong: `not_configured` and `not_authenticated` suggest `configure` and `login`, which would overwrite the file; `input` blames arguments the user never gave; `internal` (1) says "bug".

## Upgrade and downgrade

- Upgrade: files load as before; each is rewritten with the current version the next time the tool writes it (config on the next `configure`, the session on the next refresh or login, the history on the next event).
- Downgrade after an upgrade: the older build finds a newer version and stops with "written by a newer version of schoolsoft-agent … update". By design: an older build cannot know what a newer field means, and silently dropping it could lose a login or a setting. The way back is to update again, or, if the user really wants the older build, to delete the named file (for the session: log in again).

## Design

`src/core/versioned.ts` is pure (no fs, no `process.env`): `VersionedFormat` (a list of migrations; the current version is its length), `readVersioned`, `loadVersioned` (maps every failure except a newer version to the caller's corrupted-file behaviour), `writeVersioned`, `storedVersion`, `describeVersion`, `NewerFormatError`. Each format is declared next to its type: `CONFIG_FORMAT` in `config.ts`, `SESSION_FORMAT` in `store.ts`, `HISTORY_FORMAT` in `history.ts`, `OAUTH_STATE_FORMAT` in `oauth.ts`, `IDENTITY_FORMAT` in `start.ts`. A future change is one migration function and one entry in that list. Connector storage stays in `src/http`; core imports no adapter.

`doctor` reports the stored version of `config.json`, `session.enc` and `session-history.json`, and reports a newer file as a failed check with the same message.

</frozen-after-approval>

## Tasks & Acceptance

- [x] For each file kind: v0 loads and is rewritten with a version; the current version loads; a newer version fails with the message in both languages and the file is byte-for-byte unchanged; a malformed version takes the corrupted-file path.
- [x] `doctor` shows each file's version and reports a newer one.
- [x] Architecture and troubleshooting pages describe it in plain language.

## Verification

See the pull request for the gate results.
