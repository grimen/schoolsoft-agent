# Host capability probe (E7)

Refs #30 (E7), the write framework spec (#59, E7.1) and the live-session runbook (#63,
question W8). Status: built offline; not yet run against any real Claude or ChatGPT
account.

## Problem

The write framework decides how a person confirms a change from what each AI host
does with write-style tools: whether it supports MCP elicitation (form and URL mode)
on a remote connector, re-authorises on a `403 insufficient_scope` challenge, asks
before a tool marked `destructiveHint: true`, offers "Always allow", and how it shows
a preview before a confirm call. The read-only connector cannot answer any of this,
and none of it needs SchoolSoft. The runbook would otherwise spend part of the one
BankID sitting on it.

## What it is

A stub MCP server, **schoolsoft-agent probe**, that offers only `probe_*` tools with
fake data, never contacts the school portal and records what the host did. It runs in
two modes:

- **stdio** for hosts that start local servers (Claude Desktop, Claude Code). No
  OAuth; everything but the scope questions.
- **http** for remote connectors (Claude web and mobile, ChatGPT web and mobile)
  behind the same public routes as the connector (a named Cloudflare Tunnel). It uses
  the connector's own OAuth provider (`ConnectorOAuthProvider`: registration limited
  to the Claude and ChatGPT callbacks, PKCE, rotation, revocation), its owner sign-in
  (`OwnerSessions`) and page helpers, so the scope questions meet the real flow. Its
  consent page lists the probe scopes instead of children.

## Where it lives and why it does not ship

`src/http/probe/`, so it can reuse the connector's OAuth pieces inside the `http`
adapter without a boundary exception, and so the coverage gate measures it. The build
(`tsconfig.json`) excludes the directory: nothing of it reaches `dist/`, the npm
package or the connector image, and no shipped file imports it. `make host-probe` and
`make host-probe-stdio` run it from the checkout with `tsx`; nothing starts it by
default. `scripts/pack-smoke.sh` (`make check-package`) fails if a probe file is in the
tarball, and a packaging test fails if a file outside the directory imports it.

No existing connector file changes. The probe copies the connector's response
hardening (CSP, `frame-ancestors 'none'`, `nosniff`, HSTS, `no-store`), its Host check,
Origin and CSRF checks on owner posts, the `__Host-owner` cookie and the per-caller
rate limits, and uses `Referrer-Policy: same-origin` from the start (#58 explains why
`no-referrer` breaks owner posts in real browsers).

## Tools

| Tool | Annotations (RO, D, I, OW) | Question |
| --- | --- | --- |
| `probe_read` | true, false, true, false | Baseline: does the host ask before a read-only tool? |
| `probe_read_open_world` | true, false, true, true | Does `openWorldHint` alone change that? (the connector's reads look like this) |
| `probe_write_reversible` | false, false, true, false | Does the host ask before a non-read-only, non-destructive tool? |
| `probe_write_destructive` | false, true, false, true | Does it ask before `destructiveHint: true`; is "Always allow" offered? It changes nothing |
| `probe_elicit_form` | true, false, false, false | Form elicitation: declared, shown, how the preview reads, accept, decline or cancel |
| `probe_elicit_url` | true, false, false, false | URL elicitation (`elicitation/create`, `mode: "url"`): shown, opened, completed |
| `probe_elicit_url_required` | true, false, false, false | URL elicitation by error (`-32042`, `URLElicitationRequiredError`) and the retry after it |
| `probe_step_up` | true, false, true, false | Re-authorisation on `403 insufficient_scope` for a scope in `scopes_supported` (http only) |
| `probe_step_up_meta` | true, false, true, false | The same, challenged in a `200` tool result with `_meta["mcp/www_authenticate"]`, as ChatGPT apps document (http only) |
| `probe_step_up_hidden` | true, false, true, false | The same for a scope not in `scopes_supported` (http only) |
| `probe_confirmed_write` | false, true, false, true | #59's preview → confirmation token pair with a fake absence: how the preview shows, whether the model confirms without asking |

Every tool is listed whatever the grant holds. `probe_step_up` and `probe_step_up_hidden`
calls without their scope get `403` with `WWW-Authenticate: Bearer
error="insufficient_scope", scope="<granted and required>", resource_metadata="…"`, the
MCP step-up challenge; `probe_step_up_meta` answers an `isError` result carrying the same
challenge in `_meta["mcp/www_authenticate"]`, and every listed tool carries ChatGPT's
top-level `securitySchemes`. Scopes: `probe_read` (needed for any call, ticked by
default), `probe_step_up` and `probe_step_up_meta` (advertised, unticked by default, like
a write scope in #59) and `probe_step_up_hidden` (accepted when requested, never
advertised). The `initialize` request is recorded raw, before the SDK rewrites a legacy
`elicitation: {}` into form mode; per-request capabilities in `_meta` (2026-07-28) are
recorded by name. The SDK (1.30.0) speaks up to 2025-11-25, so a newer host negotiates
down; the log shows what it asked for.

`probe_confirmed_write` follows #59 without SchoolSoft: the first call returns a
preview, a `write_id`, an opaque `wct_` token and `expires_at` (10 minutes), stored
only as a keyed hash; the second call with the same arguments and the token "sends"
(nothing happens) once. A spent token with the same arguments and binding replays the
recorded outcome; any change to the arguments voids it (`write_input_changed`). The
binding is the OAuth grant over http and "local" over stdio.

The URL-elicitation page is served by the probe: over http behind the owner sign-in
(the #59 owner channel), which also records whether the `SameSite=Strict` owner cookie
arrived when the host opened the link; over stdio on a loopback listener started on
first use.

## What it records

One JSON line per event to `.host-probe/events.jsonl` (gitignored; `PROBE_LOG`
overrides) and a one-line summary on stderr: the client's name, version, protocol
version and declared capabilities at `initialize`; every JSON-RPC method received;
tool calls (the tool and its argument **names**, never values); elicitation requests,
their answer (`accept`, `decline`, `cancel`) and how long the answer took; URL pages
opened and completed; step-up challenges; OAuth registration (client name, callback
host), authorisation (requested scopes), token requests (grant type, requested
scopes), consent (approved scopes); previews and confirmations with the seconds in
between. Never an IP address, token, password, cookie or argument value. Paths are
logged without query strings, with ids replaced by `:id`.

## Tests

Offline, 100% coverage like the rest of `src/`: each tool against an in-memory MCP
client (with and without elicitation capabilities, accepting, declining, cancelling);
the confirmation store (expiry, single use, replay, changed input, other binding); the
http app end to end over real HTTP (owner sign-in, consent, OAuth with PKCE, a stateful
MCP session with elicitation, the `403` challenge and its header, re-consent with the
step-up scope, the URL page with and without the owner cookie, hardening headers,
Host, Origin and CSRF refusals, session limits); the stdio entry spawned once; the log
never containing argument values, tokens or passwords.

## Not answered here

Anything that needs a person looking at the host's UI is recorded in the results
table of `docs/development/host-probe.md`, not by the probe: whether a prompt was shown,
what it said, whether "Always allow" was offered. The probe's log only shows what
reached the server. Running it against a real Claude or ChatGPT account and deploying it
publicly are the repository owner's steps.
