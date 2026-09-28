---
title: Privacy follow-ups (E10.4 continued)
type: fix
created: 2026-09-28
status: in-review
route: dispatch
context:
  - AGENTS.md
  - docs/getting-started/data-handling.md
  - docs/development/architecture.md
  - docs/planning/specs/2026-09-26-privacy-small-fixes.md
  - docs/planning/specs/2026-09-26-versioned-state.md
  - https://github.com/grimen/schoolsoft-agent/issues/64
---

# Privacy follow-ups (E10.4 continued)

This finishes #64 except its first item (other families' data reaching the AI
provider), which is a product decision handled separately. It covers: a full
reset for "Disconnect everything", an evaluation of the OS keychain for
`key.bin`, the per-login stderr diagnostic (E9.4, #31), redacting the home
directory from `Fatal:` lines, three doc errors, and three links to the
data-handling page.

<frozen-after-approval>

## 1. "Disconnect everything" is now a full reset

Decision: make the existing "Disconnect everything" button do the full reset,
rather than adding a second "Reset connector" action.

Reasoning: the button already sits behind the owner dashboard, which requires
the admin password and a session cookie, and every POST to it is CSRF- and
origin-checked. Nobody can reach it without already being the owner. A second
button gated by the same login would add a decision for the owner ("which one
do I want?") without adding any protection a determined owner does not
already have through the first button. The stability-policy question is
whether *quietly* changing what a button already labelled "Disconnect
everything" does is a compatibility break: it is not, because the button's own
copy already promised "removes the saved SchoolSoft session" and the change
only makes the promise more complete, plus updates the copy to say so.

The identity pin's job (`identity.enc`, checked in `checkIdentity()` in
`src/http/runtime.ts`) is to stop a second SchoolSoft user from taking over a
connector that is still connected to AI apps — a different guardian signing
in should not silently start handing a stranger's household data to the
first guardian's already-approved apps. That protection is only meaningful
while the connector is *in use*. Once the owner has deliberately asked to
disconnect everything, the connector has no apps, no session and no history
left to protect, so pinning a guardian to an otherwise-empty connector serves
no purpose — it would only force the same owner to delete the state directory
by hand to actually start over, which is exactly the friction #64 flagged.

Implementation: `ConnectorRuntime.resetAll()` (`src/http/runtime.ts`) logs out
the session as before, then clears the identity pin and the sign-in history;
`ConnectorOAuthProvider.resetAll()` (`src/http/oauth.ts`) revokes every grant,
pending consent, code and token as `revokeAll()` already did, and additionally
drops the registered OAuth clients themselves. `POST /owner/schoolsoft/logout`
now calls both. Plain `logout()`/`revokeAll()` are unchanged and still used
where only a session or grant set — not the whole account — should go (tests,
and the probe's separate "Disconnect every app").

## 2. `key.bin` and the OS keychain: evaluated, not implemented

The data-handling page and `sealed.ts` already say plainly that the key sits
next to the files it protects, and that this defends against a single file
being copied out (a backup, a synced folder) but not against something that
can read the whole state directory.

Evaluated: using the OS keychain (macOS Keychain, Windows Credential Manager,
Linux Secret Service) to hold the 32-byte key instead of `key.bin`, for local
(CLI/MCP) installs only — the connector already keeps its key outside the
disk entirely (`SCHOOLSOFT_STORAGE_KEY`, an environment variable), so this
would not change it.

Decision: **do not implement it now.** Reasons:

- **No well-supported option without a new native dependency.** The
  established Node library for this (`keytar`) is deprecated and unmaintained,
  and it and its actively maintained successors (e.g. `@napi-rs/keyring`) are
  native addons — prebuilt binaries per OS/arch/Node ABI, a real supply-chain
  and install-reliability cost for a CLI that today has zero native
  dependencies (`docs/development/architecture.md`). The task that raised this
  explicitly asks not to add one silently.
- **Shelling out avoids the native dependency but trades it for three
  different, less reliable integrations.** macOS's `security` CLI is fine.
  Windows has no first-class CLI for Credential Manager; scripting it means a
  PowerShell child process and DPAPI plumbing. Linux's `secret-tool` needs
  `libsecret` and a running secret-service provider (GNOME Keyring or
  equivalent) with the login keyring already unlocked — not guaranteed on a
  minimal desktop, and never true on a headless Linux box, which is exactly
  where a fair number of this project's CLI/MCP users run it (a home server,
  a NAS, a always-on Raspberry Pi).
- **The keychain would need a fallback anyway**, for headless Linux and for
  CI/test environments, and that fallback is `key.bin` — so the change adds a
  second code path and three new failure modes (locked keyring, missing
  `secret-tool`, denied OS prompt) for a protection that only improves the
  single-file-copied-out case, which `sealed.ts`'s per-file AEAD tag already
  covers reasonably (the attacker needs the key file, not just one `.enc`
  file, either way).

This is a "when it's small and well-supported" bar, and it does not clear it
today. Revisit if a maintained, dependency-free (pure JS, no native build, no
shelled-out platform tool with its own runtime preconditions) cross-platform
option appears. No code or doc changes follow from this section; the
data-handling page's existing statement stays accurate.

## 3. Per-login stderr diagnostic (E9.4, #31): linked, not silenced

The line lives in `BankIdBrowserStrategy.login()`
(`src/providers/schoolsoft/auth/bankid-browser.ts`): one `console.error` per
portal login, comparing the `userType`/`clientId` requested against what the
issued token actually claims, to explain a class of "Vi kunde inte hitta
användaren" failures that are otherwise silent. It carries no name, token or
identifier — its own comment already says so.

Quieting it by default would need a new config surface (an env var parsed by
`src/core/config.ts`, threaded through `resolveConfig`, `wiring.ts`,
`providers/schoolsoft/index.ts` and `BankIdBrowserOptions`) purely to gate one
diagnostic line — more surface than "trivial", for a line that is not
identifying and exists to make a real failure mode debuggable. Issue #31's
E9.4 story already links to #64 (`see #64`); no further edit was needed there.
No change; left for E9.4 to size properly if a host's stderr-retention
behavior turns out to matter in practice.

## 4. `Fatal:` lines no longer carry the home directory

`src/cli/index.ts` and `src/mcp/index.ts` print `Fatal: <error message>` (and,
for the MCP server, the stack) when start-up throws. A `node:fs` error
message routinely embeds the failing path, and a path under the user's home
directory embeds their OS user name (`/Users/<name>/...`,
`/home/<name>/...`, `C:\Users\<name>\...`).

`src/shared/redact-home.ts` replaces every occurrence of `homedir()` in a
message with `~`, matching the path in either slash style (a message built on
one platform can still quote the other style). Both entry points redact
before printing. Tested directly (`test/unit/redact-home.test.ts`); the entry
points themselves stay outside the coverage requirement, as before
(`.c8rc.json`).

## Doc errors

- `docs/development/architecture.md` said `session.enc` holds "cookies".
  Checked against `src/core/session/session-manager.ts` and the auth
  strategies: only `login --web` cookies are saved there (`webLogin()`); the
  app-session `JSESSIONID`/`hash` cookies used for ordinary reads are derived
  fresh from the stored token each time and never written to disk. Fixed to
  say so.
- The same file listed `schools.json` and `key.bin` as connector files. The
  connector (`src/http/start.ts`) never creates either — it holds its key in
  `SCHOOLSOFT_STORAGE_KEY` and has no school-lookup file. (The data-handling
  page already said this correctly; only `architecture.md` was wrong.) Fixed.
- `plugins/mcpb/manifest.json`'s `config_dir` default pointed at the macOS
  path (`${HOME}/Library/Application Support/schoolsoft-agent`) unconditionally.
  Fixed per the mcpb manifest spec's per-platform `user_config` defaults.

## Links to the data-handling page

Added to the three places #64 named: the owner dashboard's hosting-provider
paragraph (`src/http/server.ts`), the consent page's "sent to your AI
provider" sentence (same file), and `privacy_policies` in
`plugins/mcpb/manifest.json` (previously `README#privacy`). All three use the
public GitHub docs URL, matching how other in-app text already links out, and
none of the edits touch the connector's Content-Security-Policy (all `<a>`
links, no new script or style source).

</frozen-after-approval>
