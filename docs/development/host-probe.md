# Host capability probe

A stub MCP server, **schoolsoft-agent probe**, that answers how Claude and ChatGPT handle
write-style tools, without SchoolSoft and without BankID. It offers `probe_*` tools with
fake data (one made-up "Probe Child"), never contacts the school portal, never reads a
saved session, and records what the host did in `.host-probe/events.jsonl` (gitignored).
Design: [host probe spec](../planning/specs/2026-09-26-host-probe.md). It answers runbook
question **W8** and the host rows of the write framework's open questions (#59); see
[What it answers](#what-it-answers).

It is not part of the package or the connector image (the build leaves `src/http/probe/`
out; `make check-package` fails if it is packed). It runs from a checkout only, and only
when you start it.

## Tools and the question each answers

| ID   | Question                                                                                              | Tool or evidence                                            |
| ---- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| HP1  | Which elicitation modes does the host declare at `initialize` (form, URL, legacy `{}`)?               | `initialize` event (raw capabilities), any tool             |
| HP2  | Is a form elicitation shown; how does the preview read; do accept, decline and cancel work?           | `probe_elicit_form`                                         |
| HP3  | URL elicitation: full URL shown, consent before opening, page opened, completion noticed?             | `probe_elicit_url`                                          |
| HP4  | URL elicitation by error (`-32042`): shown, and the call retried after the page?                      | `probe_elicit_url_required`                                 |
| HP5  | Does the host ask before a read-only tool?                                                            | `probe_read` (read-only, closed world)                      |
| HP6  | Does `openWorldHint: true` alone change that? (the connector's reads look like this)                  | `probe_read_open_world`                                     |
| HP7  | Does it ask before a write that is not destructive (`readOnlyHint: false`, `destructiveHint: false`)? | `probe_write_reversible`                                    |
| HP8  | Does it ask before `destructiveHint: true`, and with what wording?                                    | `probe_write_destructive` (changes nothing)                 |
| HP9  | Is "Always allow" offered for HP7 and HP8, and does it last for the chat or for good?                 | the prompts of HP7 and HP8                                  |
| HP10 | How is a preview result (text plus `structuredContent`) shown before the confirm call?                | `probe_confirmed_write`, first call                         |
| HP11 | Does the model confirm without asking the user? Seconds between preview and confirm                   | `probe_confirmed_write`, `write` events                     |
| HP12 | Which scopes does the host request on first connect?                                                  | `oauth` `authorize` event; the consent page                 |
| HP13 | Does it re-authorise on HTTP `403 insufficient_scope` for an advertised scope, and retry the call?    | `probe_step_up`                                             |
| HP14 | The same for a scope that is not in `scopes_supported` (can write scopes stay unadvertised?)          | `probe_step_up_hidden`                                      |
| HP15 | Does it re-authorise on a tool result carrying `_meta["mcp/www_authenticate"]`?                       | `probe_step_up_meta`                                        |
| HP16 | After re-authorising, does it keep the MCP session or start a new one?                                | `session` events (`rebound_to_new_grant` or a new `opened`) |
| HP17 | When the host opens the URL page, does the owner's `SameSite=Strict` cookie arrive (owner channel)?   | `url_page` event `ownerCookie`                              |
| HP18 | Which protocol version does the host ask for; does it send 2026-07-28 per-request capabilities?       | `initialize` `protocolVersion`, `rpc` `metaCapabilities`    |

Scopes: `probe_read` (needed for every call, ticked at consent), `probe_step_up` and
`probe_step_up_meta` (advertised, unticked, like #59's write scopes) and
`probe_step_up_hidden` (accepted when asked for, never advertised). Tools that need a
scope are listed whatever the grant holds. The step-up tools exist only over HTTP.

## Run it locally (Claude Desktop, Claude Code)

Local hosts start the probe over stdio. That covers HP1 to HP11 and HP18; the scope
questions need the HTTP mode below.

```sh
make setup                 # once
make host-probe-stdio      # to try it by hand; a host starts it itself
```

**Claude Desktop** (`claude_desktop_config.json`, absolute paths):

```json
{
  "mcpServers": {
    "schoolsoft-agent-probe": {
      "command": "/absolute/path/to/checkout/node_modules/.bin/tsx",
      "args": ["/absolute/path/to/checkout/src/http/probe/cli.ts", "stdio"]
    }
  }
}
```

If Claude Desktop cannot find `node`, use the absolute path of `node` as `command` and
put `/absolute/path/to/checkout/node_modules/tsx/dist/cli.mjs` first in `args`.

**Claude Code**:

```sh
claude mcp add schoolsoft-agent-probe -- /absolute/path/to/checkout/node_modules/.bin/tsx /absolute/path/to/checkout/src/http/probe/cli.ts stdio
```

The URL-elicitation page is then served on `http://127.0.0.1:<random port>` and has no
password. Remove the entry when you are done.

Claude Code can also reach the HTTP probe, but its OAuth uses a loopback callback, which
the connector's provider (and so the probe) refuses at registration: only the Claude and
ChatGPT web callbacks are accepted. That is itself a finding for the connector.

## Run it publicly (Claude web and mobile, ChatGPT web)

Remote connectors need a public HTTPS address. Use a **named** Cloudflare Tunnel as in the
[Cloudflare guide](../deployment/cloudflare.md), with its own hostname: Quick Tunnels do
not carry Server-Sent Events, and elicitation arrives over them.

1. In Cloudflare, add a public hostname to a tunnel, for example `probe.your-domain.com`,
   pointing at `http://localhost:8787`. Do not reuse the connector's hostname.
2. Start the probe on the same computer (it listens on 127.0.0.1 only):

   ```sh
   PROBE_PUBLIC_URL=https://probe.your-domain.com PROBE_PROXY_HOPS=1 make host-probe
   ```

   It prints a password for this run unless `PROBE_ADMIN_PASSWORD` is set (32 or more
   random characters, for example from `openssl rand -base64 32`). It is not the
   connector's password.

3. Run the tunnel: `cloudflared tunnel run --token <tunnel token>`.
4. Open `https://probe.your-domain.com/owner` and sign in. The dashboard shows the
   connector address, connected apps and the latest events.
5. Add `https://probe.your-domain.com/mcp` as a custom connector: in Claude under
   Settings, Connectors, **Add custom connector**; in ChatGPT with developer mode on,
   as a new app or connector. On the consent page leave only `probe_read` ticked.
6. Use the same Claude account on the phone app to cover Claude mobile (connectors added
   on the web show up there). ChatGPT documents custom MCP apps as web only; check whether
   the app appears on the phone anyway.
7. Afterwards: remove the connector in each app, **Disconnect every app** on the
   dashboard, stop the probe (Ctrl-C) and the tunnel, and delete the hostname.

Settings: `PROBE_PUBLIC_URL` (required; `http://localhost:<port>` is accepted for local
browser tests), `PROBE_ADMIN_PASSWORD`, `PROBE_PORT` (8787), `PROBE_PROXY_HOPS` (0 to 2;
1 behind the tunnel), `PROBE_LOG` (default `.host-probe/events.jsonl` in the checkout).
Grants live in memory: a restart disconnects every app.

## A session, host by host

In each host and platform, in a new chat, ask in order and fill in the
[observed table](#observed):

1. "Call probe_read." Then "Call probe_read_open_world." (HP5, HP6)
2. "Call probe_write_reversible." Then "Call probe_write_destructive." Note each prompt's
   wording and buttons, choose Allow once, then call each again and note whether the
   prompt returns. Look for "Always allow" in the prompt and in the connector's settings.
   (HP7 to HP9)
3. "Pretend to report an absence for 2026-10-05 with probe_confirmed_write." Note how the
   preview shows, and whether the model calls again with the confirmation before you say
   yes. Then say yes. (HP10, HP11)
4. "Call probe_elicit_form." Answer once with yes, once with Decline, once by closing the
   dialog. (HP2)
5. "Call probe_elicit_url." Open the page, sign in if asked, press Done. (HP3, HP17)
6. "Call probe_elicit_url_required", finish the page, then "Try again." (HP4)
7. HTTP only: "Call probe_step_up", "Call probe_step_up_hidden", "Call
   probe_step_up_meta". If the host sends you back to the consent page, tick the scope it
   asks for. (HP12 to HP16)

Then copy the relevant lines of `.host-probe/events.jsonl` (or the dashboard list) next
to your notes. Every event has a time, the MCP session tag and the host's client name.

## What the log holds

One JSON line per event: `started`, `http` (method, path without query, status),
`oauth` (register: client name and callback host; authorize and token: requested
scopes, grant type, status; consent: approved scopes), `initialize` (client name and
version, protocol version, declared capabilities), `rpc` (method), `tool_call` (tool
and argument **names**), `elicitation` (mode, outcome, milliseconds, confirmed),
`url_page`, `url_required`, `step_up`, `write` (write id, outcome, seconds since the
preview) and `session`. Never an IP address, token, password, cookie, header or
argument value. The probe has no personal data to log: every value it shows is made up.

## Documented answers (2026-09-26)

What the specification and the hosts' own documentation say, before anything is
observed. "Not documented" means the searched pages say nothing either way.

**MCP specification.** The current revision is
[2026-07-28](https://modelcontextprotocol.io/specification/versioning); the probe's SDK
(`@modelcontextprotocol/sdk` 1.30.0) speaks up to
[2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25), so a newer host
negotiates down to it (HP18 records what it asked for).

- Elicitation has form and URL modes in both revisions. In 2025-11-25 the client declares
  `elicitation: { form, url }` at `initialize` (an empty object means form) and the server
  sends `elicitation/create`; `-32042` (`URLElicitationRequiredError`) and
  `notifications/elicitation/complete` exist. In 2026-07-28 the capability travels in each
  request's `_meta`, the server returns an `input_required` result that the client answers
  by retrying, and `-32042` and the completion notice are gone
  ([elicitation 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation),
  [elicitation 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation),
  [changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog),
  [schema](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2026-07-28/schema.ts)).
  Clients must show which server asks and offer decline and cancel; for URL mode they must
  show the full URL and get consent before opening it. Form mode must not ask for secrets.
- Tool annotations default to `readOnlyHint: false`, `destructiveHint: true`,
  `idempotentHint: false`, `openWorldHint: true`, and clients must treat them as untrusted
  unless the server is trusted. There should always be a human able to deny a tool call
  ([tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)).
- Scopes: the client should use the `scope` of the 401 challenge, else all of
  `scopes_supported`, which is meant to be the minimal set. On `403` with
  `error="insufficient_scope"` a client acting for a user should step up and retry. In
  2026-07-28 the client requests the union of earlier and challenged scopes
  ([authorization 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization),
  [authorization 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)).

**Hosts.** Anthropic documents connectors for Claude web, Desktop and mobile together
(they share one OAuth client); Claude Code runs its own client. Pages checked on
2026-09-26.

| ID     | Claude (web, Desktop, mobile)                                                                                                                                                                                                                                  | Claude Code                                                                                                                                                                 | ChatGPT (web; mobile)                                                                                                                                                                                                                                                                                                |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HP1–3  | Not documented: [supported features](https://claude.com/docs/connectors/building) do not list elicitation; an open request asks for it ([claude-ai-mcp#153](https://github.com/anthropics/claude-ai-mcp/issues/153)). Local stdio in Desktop: not documented   | Yes, form and URL ([MCP](https://code.claude.com/docs/en/mcp#respond-to-mcp-elicitation-requests), `Elicitation` [hook](https://code.claude.com/docs/en/hooks#elicitation)) | Unknown: the docs recommend elicitation for structured input but name no mode ([MCP server](https://developers.openai.com/plugins/build/mcp-server))                                                                                                                                                                 |
| HP4    | Not documented                                                                                                                                                                                                                                                 | Not documented                                                                                                                                                              | Not documented                                                                                                                                                                                                                                                                                                       |
| HP5    | No prompt: read-only tools run without per-call confirmation ([review criteria](https://claude.com/docs/connectors/building/review-criteria))                                                                                                                  | Not documented in relation to annotations                                                                                                                                   | No prompt: `readOnlyHint` is respected, anything without it is a write ([developer mode](https://developers.openai.com/api/docs/guides/developer-mode))                                                                                                                                                              |
| HP6    | Not documented                                                                                                                                                                                                                                                 | Not documented                                                                                                                                                              | Not documented beyond "safety behavior"; `openWorldHint` is required for apps ([reference](https://developers.openai.com/plugins/reference))                                                                                                                                                                         |
| HP7    | Not documented (only read-only and destructive are named)                                                                                                                                                                                                      | Not documented                                                                                                                                                              | Yes: write actions need confirmation by default ([developer mode](https://developers.openai.com/api/docs/guides/developer-mode))                                                                                                                                                                                     |
| HP8    | Yes: destructive tools always prompt ([review criteria](https://claude.com/docs/connectors/building/review-criteria))                                                                                                                                          | Not documented; `_meta["anthropic/requiresUserInteraction"]` forces a prompt ([MCP](https://code.claude.com/docs/en/mcp))                                                   | Yes ([developer mode](https://developers.openai.com/api/docs/guides/developer-mode), [reference](https://developers.openai.com/plugins/reference))                                                                                                                                                                   |
| HP9    | Yes: "Allow once" / "Always allow" in the prompt; Always allow, Needs approval or Blocked per tool in settings; admins can withhold Always allow ([getting started](https://claude.com/docs/connectors/getting-started)). Conflicts with HP8's "always prompt" | Not documented in relation to annotations                                                                                                                                   | Conflicting: remembered for the conversation ([developer mode](https://developers.openai.com/api/docs/guides/developer-mode)) versus Allow once, Allow low-risk actions, Always allow and account-wide settings ([app permissions](https://help.openai.com/en/articles/20001495)); not for managed-workspace members |
| HP10   | Not documented                                                                                                                                                                                                                                                 | Not documented                                                                                                                                                              | Not documented                                                                                                                                                                                                                                                                                                       |
| HP11   | Not documented; the specification calls annotations untrusted hints                                                                                                                                                                                            | Not documented                                                                                                                                                              | Not documented; the docs warn a write can happen even from a tool marked read-only ([MCP](https://developers.openai.com/api/docs/mcp))                                                                                                                                                                               |
| HP12   | The 401 challenge's scope, else `scopes_supported`, plus `offline_access` when advertised ([authentication](https://claude.com/docs/connectors/building/authentication))                                                                                       | The challenge's or the resource metadata's scope, not the whole `scopes_supported` (since 2.1.196); `oauth.scopes` pins it                                                  | Partial: `scopes_supported` helps ChatGPT explain the permissions; no selection rule stated ([auth](https://developers.openai.com/plugins/build/auth))                                                                                                                                                               |
| HP13   | Yes: prompts to re-authorise and retries the same call ([lazy authentication](https://claude.com/docs/connectors/building/lazy-authentication))                                                                                                                | No: the call fails with a hint to re-authenticate with `/mcp` ([errors](https://code.claude.com/docs/en/errors))                                                            | Not documented for HTTP 403                                                                                                                                                                                                                                                                                          |
| HP14   | Yes by rule: it requests the union of the challenged and the discovery scopes ([lazy authentication](https://claude.com/docs/connectors/building/lazy-authentication)); not stated for unadvertised scopes                                                     | As HP13                                                                                                                                                                     | Unknown                                                                                                                                                                                                                                                                                                              |
| HP15   | No: a 200 result with `isError` gives no prompt ([lazy authentication](https://claude.com/docs/connectors/building/lazy-authentication))                                                                                                                       | Not documented                                                                                                                                                              | Yes: `_meta["mcp/www_authenticate"]` with `error` and `error_description`, given `securitySchemes` on the tool and protected-resource metadata; also for more scopes ([auth](https://developers.openai.com/plugins/build/auth))                                                                                      |
| HP16   | Not documented                                                                                                                                                                                                                                                 | Not documented                                                                                                                                                              | Not documented                                                                                                                                                                                                                                                                                                       |
| HP17   | Expected no: browsers withhold `SameSite=Strict` cookies on a cross-site navigation ([MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie#samesitesamesite-value))                                                             | as Claude                                                                                                                                                                   | as Claude                                                                                                                                                                                                                                                                                                            |
| HP18   | Not documented                                                                                                                                                                                                                                                 | 2026-07-28 with the v2 client runtime ([MCP](https://code.claude.com/docs/en/mcp#respond-to-mcp-elicitation-requests))                                                      | Not documented                                                                                                                                                                                                                                                                                                       |
| Mobile | Remote connectors work in the phone apps; adding them there is in beta ([connectors on mobile](https://support.claude.com/en/articles/11176164))                                                                                                               | —                                                                                                                                                                           | Custom MCP apps are web only ([apps in ChatGPT](https://help.openai.com/en/articles/12584461)); directory apps run on iOS and Android                                                                                                                                                                                |

An unofficial report says Claude Desktop's chat declares URL elicitation only and its
Code tab none for local servers ([claude-code#96043](https://github.com/anthropics/claude-code/issues/96043));
HP1 settles it.

Consequences for #59 already visible: the Claude apps answer the HTTP 403 challenge and
ChatGPT documents only the tool-result challenge, so the connector likely needs both
(HP13, HP15); Claude Code does not step up at all. Neither Claude app documents
elicitation, so token confirmation and the owner channel stay the realistic channels
until HP1 to HP3 show otherwise. The owner channel's link probably arrives without the
owner's cookie (HP17), so its page must expect a sign-in.

Found offline while building the probe: the connector's provider refuses an
authorization request without a `scope` parameter (`invalid_scope`). Hosts that follow the
specification always send one, from the challenge or `scopes_supported`; HP12 confirms it.

## Observed

One row per host and platform; mark a cell `yes`, `no`, `partial` or `n/a`, with a note
and the event time from the log. Leave the documented table above as it is.

| Host and platform             | HP1 | HP2 | HP3 | HP4 | HP5 | HP6 | HP7 | HP8 | HP9 | HP10 | HP11 | HP12 | HP13 | HP14 | HP15 | HP16 | HP17 | HP18 | Date, versions |
| ----------------------------- | --- | --- | --- | --- | --- | --- | --- | --- | --- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | -------------- |
| Claude web                    |     |     |     |     |     |     |     |     |     |      |      |      |      |      |      |      |      |      |                |
| Claude Desktop, remote        |     |     |     |     |     |     |     |     |     |      |      |      |      |      |      |      |      |      |                |
| Claude Desktop, local (stdio) |     |     |     |     |     |     |     |     |     |      |      | n/a  | n/a  | n/a  | n/a  | n/a  |      |      |                |
| Claude iOS / Android          |     |     |     |     |     |     |     |     |     |      |      |      |      |      |      |      |      |      |                |
| Claude Code (stdio)           |     |     |     |     |     |     |     |     |     |      |      | n/a  | n/a  | n/a  | n/a  | n/a  |      |      |                |
| ChatGPT web                   |     |     |     |     |     |     |     |     |     |      |      |      |      |      |      |      |      |      |                |
| ChatGPT iOS / Android         |     |     |     |     |     |     |     |     |     |      |      |      |      |      |      |      |      |      |                |

## What it answers

- **Runbook (#63), W8** ("Claude and ChatGPT, web and mobile: elicitation,
  `insufficient_scope` re-auth, `destructiveHint` prompt, Always allow"): all of it, as
  HP1 to HP9 and HP13 to HP15. The runbook's steps 23 to 25 record W8 alongside the
  connector checks; with the probe, those steps can drop W8 and the register can mark it
  "answered by the host probe (docs/development/host-probe.md)", so the BankID sitting
  does not spend time on it. The runbook's "Afterwards" item for W8 describes this probe.
- **Write framework (#59), open questions:** the row "Do Claude and ChatGPT (web and
  mobile) support form and URL elicitation on a remote connector, re-authorize on
  `insufficient_scope`, and prompt for tools marked `destructiveHint: true`; is Always
  allow offered" (HP1 to HP9, HP13); the Discovery section's deviation, whether write
  scopes can leave `scopes_supported` (HP12, HP14); and "Who confirms": how a preview
  shows and whether the model confirms on its own (HP10, HP11), whether elicitation is a
  real channel per host (HP1 to HP4), and how the owner channel's link arrives (HP3, HP4,
  HP17).
- Not answered here: everything that needs SchoolSoft (A, K, L, M, T, W2 to W7, W9, W10)
  and the connector's own acceptance (C, H, P). The probe's consent page is not the
  connector's, so it gives at most an early hint for H2.

[Development](README.md) · [All documentation](../README.md)
