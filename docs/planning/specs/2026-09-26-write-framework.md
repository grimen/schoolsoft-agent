---
title: Write framework (preview, confirmation, idempotency, audit, write scope)
type: feature
created: 2026-09-26
status: in-review
route: dispatch
baseline_commit: 7085696
context:
  - AGENTS.md
  - docs/development/architecture.md
  - docs/development/stability.md
  - docs/planning/specs/2026-09-21-absence-report.md
  - docs/planning/specs/2026-09-26-request-budget.md
  - docs/planning/specs/2026-09-26-accounts-by-school.md
  - docs/planning/specs/2026-09-26-rest-surface.md
  - docs/planning/specs/2026-09-26-capture-probe.md
  - https://github.com/grimen/schoolsoft-agent/issues/30
  - https://github.com/grimen/schoolsoft-agent/pull/66 (docs/development/host-probe.md, docs/planning/specs/2026-09-26-host-probe.md)
  - https://github.com/grimen/schoolsoft-agent/issues/67
  - https://modelcontextprotocol.io/specification/2026-07-28/changelog
  - https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation
  - https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization
  - https://modelcontextprotocol.io/specification/2026-07-28/server/tools
---

# Write framework (E7.1)

`report_absence` (#21) carries a small gate of its own: `allowWrites` off by default, a preview unless `confirm: true`, never repeated. That is enough for one write. Leave applications (E7.3), messages (E7.4) and booking answers (E7.5) are coming, and the connector and REST surface will offer writes to AI apps and custom UIs (E7.6). This spec defines the one mechanism all of them use: how an operation declares a write, how a preview becomes a confirmed send, how a send happens at most once, what is recorded, and how a remote app gets permission to write. It is a spec only. E7.2 builds it and moves `report_absence` onto it. Nothing here was run against SchoolSoft.

What the AI hosts do is taken from the host-capability probe (#66): the answers the MCP specification and the hosts' own documentation give, checked on 2026-09-26 and cited in `docs/development/host-probe.md` on that branch. None of it has been observed yet; the probe's run against the real hosts does that, and [Host questions](#host-questions-host-capability-probe-66) lists what it still has to settle.

<frozen-after-approval>

## Intent

Every write goes through the same five steps on every surface: **gate** (writes allowed here, for this operation, for this caller), **preview** (the exact change in human terms, nothing sent), **confirm** (a single-use token bound to that exact change), **send** (exactly one request, never retried) and **record** (an outcome and an audit entry that hold no child data). An operation declares what it writes; the framework owns every step around it, so a new write is one file and one registry line, like a read.

What the framework can promise, on every surface: nothing is sent without a preview of the identical change within the last 10 minutes; one confirmation sends at most once; a write stays inside the caller's grant; every attempt is recorded. What it cannot promise everywhere is that a human, not the model, gave the confirmation. The section [Who confirms](#who-confirms) says exactly where that holds and where it does not. None of these promises rests on a host's permission prompt or on tool annotations ([Host prompts and annotations are not a control](#host-prompts-and-annotations-are-not-a-control)).

## The `writes` declaration

A write operation declares `writes` instead of `run`. The registry, MCP tool, CLI command, REST route, docs and skills are generated from it as for reads.

```ts
// src/core/writes/types.ts
export type WriteEffect = "create" | "update" | "delete" | "send"; // send: delivered to a person
export type WriteTarget = "absence_notice" | "leave_application" | "message" | "booking_response";

export interface WriteDeclaration<I extends z.ZodRawShape, P, R extends Capability, W extends Capability> {
  effect: WriteEffect;
  target: WriteTarget;
  /** Can the guardian undo it in the portal? "unknown" until the live pass says. */
  reversibility: "reversible" | "irreversible" | "unknown";
  /** What an identical second send does at the portal. */
  repeat: "same_state" | "duplicates" | "unknown";
  /** Past-tense status on success ("reported", "sent", "answered"). */
  done: string;
  /** Window in which an identical intent is flagged as a possible duplicate. Default 24 h. */
  dedupeWindowMs?: number;
  /** The session the send needs ("app" cookies or the gated "web" session). */
  session: "app" | "web";
  /** Normalise the input into exactly what will be sent. Reads only: `portal` has no write capability. */
  intent(ctx: OperationContext<R>, args: z.infer<z.ZodObject<I>>): Promise<WriteIntent<P>>;
  /** What the human is shown. Built from the intent alone, no I/O. */
  preview(intent: WriteIntent<P>, lang: Lang): WritePreview;
  /** Exactly one write request through the one write capability. */
  send(ctx: OperationContext<W>, intent: WriteIntent<P>): Promise<WriteReceipt>;
  /** Optional read-back after an unknown outcome. Reads only. */
  verify?(ctx: OperationContext<R>, intent: WriteIntent<P>): Promise<"seen" | "not_seen" | "cannot_tell">;
}

export interface WriteIntent<P> {
  childId: number; // always explicit: a write never falls back to the child in focus
  payload: P; // the domain value the provider maps to a request body; the hash covers it
}

export interface WritePreview {
  title: string; // "Report Alva absent"
  child: { id: number; firstName: string };
  lines: { label: string; value: string }[]; // every field that will be sent; free text verbatim
  reversibility: string; // one sentence: how to undo it, or that it cannot be undone
  duplicate?: { writeId: string; at: string; outcome: WriteOutcome }; // set by the framework
}

export interface WriteReceipt {
  status: number;
  body: unknown | null; // null when a 2xx body does not map (see Errors)
}
```

Rules the boundary test enforces: an operation that lists a capability in `WRITE_CAPABILITIES` declares `writes`, and one that declares `writes` lists exactly one such capability, used only by `send`. `WRITE_CAPABILITIES` is derived from the declarations instead of kept by hand. Annotations are derived, not written: `readOnly: false`, `idempotent: false`, `destructive: reversibility !== "reversible"`. They tell hosts to ask where hosts do; nothing in the framework depends on it. The framework adds one input to every write operation, `confirmation` (string, optional; CLI `--confirmation`), and leaves it out of the hash.

**What a preview shows.** The operation's title with the child's first name, every value that will be sent in words (dates as dates, "whole day" rather than a flag, the recipient's name, the message body verbatim), every default the framework or operation filled in (today's date, the only child), the reversibility sentence, a duplicate warning when one applies, the expiry of the confirmation and the line "Nothing has been sent." Nothing that will be sent may be missing from the preview; a declaration test renders each operation's preview for generated inputs and checks that every payload field appears.

## Preview → confirm

### Sequence

1. **Gate.** Writes allowed in this configuration (`allowWrites`), for this operation, and on the connector and REST, the caller's grant holds the operation's write scope and the child. Otherwise `writes_disabled` or a scope refusal, before any session use.
2. **Intent.** `intent()` resolves the child, fills defaults and validates. Reads only.
3. **Duplicate check.** The ledger is searched for a write with the same intent hash whose outcome is `applied` or `unknown` inside the dedupe window. If one exists, the preview carries `duplicate`. Earlier previews that were never sent do not count.
4. **Preview.** A pending record is stored and the preview is returned with `write_id`, `confirmation` and `expires_at`. Nothing is sent and child focus is not changed for the write.
5. **Confirm.** The caller repeats the call with the same arguments and `confirmation`. The framework recomputes the intent from the arguments, checks every binding (below) and atomically claims the record.
6. **Send.** One request through the budget, marked `write`.
7. **Record.** The outcome is stored against the `write_id`, an audit entry is appended, and the result or error carries `write: { id, outcome }`.

### The confirmation token

The token is opaque: `wct_` followed by 32 random bytes in base64url. It carries no data. The server keeps a pending record under the token's keyed hash, so a token cannot be forged, reveals nothing in a transcript or log, and is useless without the record:

```ts
interface PendingWrite {
  writeId: string; // UUID v4; also the idempotency key (below)
  tokenHash: string; // HMAC-SHA256(refKey, token)
  account: string; // account key, "schoolsoft:taby"
  operation: string; // "report_absence"
  childRef: string; // HMAC(refKey, account + ":" + childId)
  intentHash: string; // HMAC(refKey, canonical JSON of { operation, childId, payload })
  binding: { kind: "local" } | { kind: "grant"; grantId: string };
  createdAt: number;
  expiresAt: number; // createdAt + 10 min
  state: "pending" | "claimed" | "awaiting_owner";
  duplicateOf?: string; // writeId shown in the preview
  ownerPreview?: WritePreview; // connector owner channel only, encrypted, deleted with the record
}
```

`refKey` is derived with HKDF from the state key (`key.bin` locally, `SCHOOLSOFT_STORAGE_KEY` on the connector), info `schoolsoft-agent write refs v1`. Keyed hashes stop anyone who reads the file from recovering a child id or dates by trying the few likely values.

**Binding.** A confirmation succeeds only if all of these hold, checked in this order: the token's record exists and has not expired; the current account is the record's account; the operation called is the record's operation; the caller is the record's binding (on the connector the same grant, which still verifies, still holds the write scope and still covers the child; locally any local surface, since the CLI and the stdio MCP server act for the same person); the child is still on the account; and the recomputed `childRef` and `intentHash` equal the record's. The binding is to the grant, not the access token: access tokens live five minutes, and a refresh between preview and confirm must not void the confirmation.

**Expiry and single use.** 10 minutes, then the record is gone. The claim is atomic (below). A claimed token cannot be claimed again. Presenting a spent token with the same arguments from the same binding returns the recorded outcome instead of sending (the replay answer holds nothing the caller did not already have); from any other binding it is `write_confirmation_invalid`.

**Input changed between preview and confirm.** Any difference in the recomputed intent (another child, another date, one changed character in a message, or "today" having become tomorrow) is `write_input_changed`. The token is voided, not kept: whatever changed, the human has not seen it, so a new preview is the only way on. Arguments that do not change the intent (a name instead of an id for the same child, whitespace the operation trims) do not count as changes, because the hash covers the normalised intent, not the raw arguments.

**Released claims.** A claim is released back to `pending` only when it is certain nothing reached the portal: the budget refused the request before sending (`portal_paused`, `portal_slow_down`, cancelled while queued), the session was missing before the send, or the process stopped before the request was handed to the transport. Anything later is an outcome.

### Who confirms

The confirmation token travels through whatever called the preview. For an AI app that is the model, so a model can in principle preview and confirm in two calls without anyone reading the preview, and the server cannot see whether a person was asked. What the hosts document (#66, checked 2026-09-26, not yet observed):

- **Claude (web, Desktop, mobile)** does not document elicitation for connectors, and an open feature request asks for it ([claude-ai-mcp#153](https://github.com/anthropics/claude-ai-mcp/issues/153)). Read-only tools run without a prompt and destructive tools "always prompt", yet the prompt offers "Allow once" and "Always allow" and each tool can be set to Always allow, which contradicts it. Remote connectors work in the phone apps; adding one there is in beta.
- **Claude Code** documents form and URL elicitation. It cannot use the connector over HTTP today ([OAuth write scope](#oauth-write-scope), #67), so it meets writes through the local stdio server, or through a connector added in claude.ai, which it inherits with a claude.ai login (open question).
- **ChatGPT** asks for confirmation before any tool without `readOnlyHint`, but its sources disagree on whether "Always allow" lasts for the conversation or for good. It recommends elicitation without naming a mode. Custom MCP apps are web only.
- **The MCP specification** makes clients treat annotations as untrusted hints and says a human "SHOULD" be able to deny a tool call: a recommendation, not a guarantee.

So no remote host can be relied on to show a person the preview, by prompt or by elicitation. The framework makes the connector's owner channel the path that works on every remote host, uses elicitation as an enhancement where a host is seen to support it, and says plainly where only the token remains:

| Surface | How confirmation arrives | What the server can prove | What it cannot |
| --- | --- | --- | --- |
| CLI (and the skill that drives it) | `--confirmation <token>` | identical change, previewed, once, in time | that a person read it. A TTY is not a person (see the stability policy on JSON output); the agent host's own command approval is the human step |
| Local MCP (stdio) | the token in `confirmation`; instead, form elicitation for a host that declares it and on which the probe has seen it work (HP1, HP2): the server asks for a yes or no in the host's own dialog during the call, and no token is returned | with the token, as CLI; with elicitation, that a conforming host showed the preview to the user, because the answer comes from the host's UI and not from the model | that the host conforms; a host that declares elicitation without showing it, or lets the model answer, defeats it |
| Connector MCP (Claude, ChatGPT) | **the owner channel, by default**: the tool answers "waiting for your confirmation" with a link to `/owner/writes/<writeId>` (as a URL-mode elicitation where a host is seen to support it, HP3, as text otherwise); the parent confirms there, signed in with the owner password, and the connector sends from that page. A grant the owner opted out: as local MCP | with the owner channel, that someone holding the owner password saw the preview on the connector's own page and clicked Confirm, whatever the host, its prompts or the model did | with the owner channel, nothing further; this is the strongest channel. Opted out, as local MCP |
| REST (custom UIs, the app) | the owner channel by default, as above; a grant the owner opted out sends `confirmation` in the confirm request | with the owner channel, as connector MCP; opted out, as CLI: the UI is trusted to have shown the preview, and the consent page says so | opted out, that the UI showed it |

Decisions:

- **The owner channel is the default for remote writes.** Every connector grant with a write scope, over MCP or REST, confirms on `/owner/writes/<writeId>` unless the owner opts out for that grant at consent ("This app may confirm changes itself", with a sentence saying that the app, and so its model, can then send without the owner seeing the change). Default rather than opt-in, because:
  - It is the only channel whose human step the server checks itself, and it needs nothing from the host: no elicitation, no prompt, no annotation handling, only a browser. It works the same in Claude web, Desktop and mobile and in ChatGPT, today.
  - The alternative fails silently. With token-only confirmation and "Always allow", an injected model writes and nobody notices until the audit log. The owner channel's cost is visible friction: a sign-in with the owner password (a 30-minute session) per write or burst of writes. A parent writes rarely (an absence, a leave application, a few messages a month), so the friction lands where it is worth it.
  - The connector has never offered a write, so the default changes nothing for anyone now. Switching it on later would narrow grants that already write.
  - Opting out stays possible: a parent's own UI or an app they trust may show the preview well, and it is their decision. The dashboard shows which grants opted out.
- **How the model follows an owner confirmation.** The preview result carries `write_id`, the link, `expires_at` and a `confirmation` token that cannot send. Presented with the same arguments, it answers "waiting for your confirmation" while the record is `awaiting_owner`, and the recorded outcome afterwards (the replay rule). The preview's text tells the model to show the link and wait. Under 2026-07-28 URL elicitation, the host's retry after the parent confirmed returns the outcome itself.
- **The owner link arrives without the owner cookie.** A host opens the link as a cross-site navigation, and browsers withhold `SameSite=Strict` cookies on those (HP17: expected, not observed). The page expects to arrive without the cookie: it shows the owner sign-in, or a same-origin continue step when a session exists, and shows no preview and accepts no POST without the cookie. The cookie stays `SameSite=Strict`. The Chromium test (#58) covers the arrival as well as the confirm post. The record keeps its 10 minutes; a parent who needs longer starts a new preview.
- **Elicitation is an enhancement, used only where it is seen to work.** A declared capability is necessary, not sufficient: an open report says Claude Desktop declares elicitation and never shows it ([claude-code#96043](https://github.com/anthropics/claude-code/issues/96043)). The framework uses form elicitation for a client that declares it (`elicitation.form`, or the legacy `{}`) and whose `clientInfo.name` is on a short list of hosts the probe has seen show, accept, decline and cancel (HP1, HP2). The list starts empty and grows from the probe's observed table. An elicitation unanswered after 2 minutes counts as cancel. The form has one boolean field ("Send this?") and the preview as its message; it asks for no secret, as the specification requires. Decline or cancel records `not_sent`. With the owner channel on, elicitation only carries the link (URL mode) and never replaces the owner's confirmation. How the protocol carries it: [MCP protocol revision](#mcp-protocol-revision).
- **Token-only confirmation stays for the local surfaces**, with the limits in the table. The CLI and the stdio server act for the person at the keyboard, whose agent host approves commands and tool calls, and there is no owner password or dashboard to confirm on. `write_log` shows every preview and send afterwards.
- **The preview's text tells the model what to do.** Show the preview to the user, confirm only after they say yes, never on its own, never after an error. That is advice to the model, not a control, and the documentation does not present it as one.

### Host prompts and annotations are not a control

Write tools carry honest annotations so that hosts ask where they do. They are hints. The specification makes clients treat them as untrusted, and its human in the loop is a "SHOULD". Claude and ChatGPT both let a user stop being asked ("Always allow", and ChatGPT's remembered approvals). Claude's "destructive tools always prompt" sits next to its own "Always allow". ChatGPT warns that a write can happen even from a tool marked read-only. So a host prompt counts as defence in depth, never as a proof. The gate, preview, binding, single use, limits, write scopes and audit hold with every prompt set to "Always allow", and that is why the owner channel, not the host's prompt, is the default for remote writes.

### MCP protocol revision

- **2026-07-28 is the current revision, and elicitation changed in it.** There is no `initialize` handshake and no protocol session. Client capabilities travel on every request in `_meta` (`io.modelcontextprotocol/clientCapabilities`). A server asks for input by returning an `input_required` result whose `inputRequests` hold an `elicitation/create`; the client answers by retrying the same `tools/call` with `inputResponses` and the server's `requestState`. `-32042` (`URLElicitationRequiredError`) and `notifications/elicitation/complete` are removed. Nothing in the framework depends on a protocol session: a confirmation is bound to the grant, or to "local".
- **The SDK lags.** The repository pins `@modelcontextprotocol/sdk` ^1.30.0, which speaks up to 2025-11-25, so a newer host negotiates down to it. The TypeScript SDK's v2 line (`@modelcontextprotocol/server`, 2.0.0 from 2026-07-27) implements 2026-07-28. Claude's hosted connectors document the authorization specification up to 2025-11-25; Claude Code's v2 runtime offers 2026-07-28.
- **E7.2 targets 2025-11-25 on the pinned SDK.** Form elicitation is the server's `elicitation/create` request, gated as in [Who confirms](#who-confirms). E7.2 uses neither `-32042` (removed, and documented by no host, HP4) nor the completion notice. The "ask the person" step sits behind a small port (answers: accept, decline, cancel, unavailable), so 2026-07-28 is an adapter change: the `input_required` result carries the preview, and `requestState` carries the `writeId` sealed with `refKey`, because the client can alter it. The retry passes every binding check like any confirmation.
- **Re-check before E7.2 starts:** whether SDK v2 serves 2025-11-25 and 2026-07-28 clients side by side, and what moving to it costs (an upgrade of its own, not part of E7.2); which revision each local host asks for, and whether it sends per-request capabilities (HP18); whether the cited elicitation and authorization pages changed; and the probe's observed HP1 and HP2 rows, which fill the elicitation list.

## Idempotency

SchoolSoft offers no idempotency key of its own, and none of its write endpoints is known to reject a duplicate. The framework therefore makes the send at-most-once on its side and makes a second attempt a visible decision.

- **Who generates the key.** The server, at preview: the `writeId`. A client never supplies one. A REST client that loses the answer to its confirm request re-sends the same body with the same token and gets the recorded outcome (the replay rule above), which gives it the effect of an `Idempotency-Key` without a second mechanism.
- **Where it is stored.** In the write ledger, per account: locally `<stateDir>/writes.json` (0600, versioned, one entry per account like `session.enc`); on the connector `writes.enc` in the encrypted repository. Cross-process safety on one machine comes from a lock file, `<stateDir>/writes.lock`, created with exclusive create (`O_EXCL`) around every read-modify-write of the ledger and considered stale after 30 seconds. The claim and the move to `sending` happen under the lock and are persisted before the request leaves; the send itself happens outside it. The connector is one process and serialises in memory as it does for OAuth state.
- **Lifetime.** Pending records live 10 minutes. The outcome of every write stays in the audit log (90 days), which is also what the duplicate check searches.
- **After an unknown outcome** (a timeout, a network failure after the request left, a 5xx or a 429 on the write): nothing is retried, not by the budget, not by session recovery, not by the framework. The outcome is recorded as `unknown` and the error says so, with `retryable: false`. Then:
  1. If the operation declares `verify` and the breaker is closed, the framework runs it once, as an ordinary read. `seen` turns the outcome into `applied` (`verifiedBy: "read_back"`). `not_seen` and `cannot_tell` leave it `unknown`: a list that does not show the write yet does not prove the portal dropped it.
  2. A new attempt starts with a new preview, which carries the `duplicate` warning with the earlier time and outcome. The human decides. `repeat: "same_state"` writes (answering a booking with the same slot) say that sending again is harmless; `duplicates` and `unknown` say it may register twice.
  3. `write_log` (below) shows the outcome and the time, and the error's hint tells the user to look in SchoolSoft before trying again.
- **A process that dies mid-send.** A record found in `sending` longer than the write timeout (30 s) becomes `unknown`, never `pending`.

Rejected: adding a marker to the parent's free text so a later read can recognise it. A write sends what the parent approved and nothing else.

## Audit log

Every preview, confirmation and outcome is appended to the account's audit log. It holds no child data: no names, no message bodies, no reasons, no dates of the absence, no free text of any kind.

```ts
interface WriteAuditEntry {
  at: string; // ISO UTC
  writeId: string;
  account: string; // "schoolsoft:taby"
  operation: string;
  effect: WriteEffect;
  childRef: string; // keyed hash; resolved to a first name only when a surface renders it
  intentRef: string; // = intentHash; lets the duplicate check find it
  event: "previewed" | "confirmed" | "not_sent" | "applied" | "rejected" | "unknown" | "expired" | "declined";
  surface: "cli" | "mcp" | "connector" | "rest";
  confirmedVia?: "token" | "elicitation" | "owner";
  client?: { grantRef: string; name: string }; // connector: keyed hash of the grant id, the app's name (max 60 chars)
  http?: number; // the portal's status for the send
  errorKind?: ErrorKind;
  verifiedBy?: "response" | "read_back";
}
```

- **Where.** In the write ledger next to the pending records (`writes.json` locally, `writes.enc` on the connector), per account, so accounts never see each other's writes.
- **Retention.** 90 days or 500 entries per account, whichever is reached first, pruned on write. Enough to look back over a term; small enough that nothing lingers. Logout does not delete it (it holds no data about the child); deleting the state directory does.
- **How a parent reads it.** Locally, a read-only operation `write_log` (`schoolsoft-agent write-log`, MCP tool `schoolsoft_write_log`) with optional `write_id` and `limit`. It resolves `childRef` to a first name by hashing the current children's ids; a child no longer on the account shows as "a former child". It needs no request to the portal when the session is restored. On the connector, the owner dashboard shows a "Recent changes" table (time, app, operation, child, outcome); the log is not offered to AI apps or over REST in E7.6.
- **Diagnostics bundle (E10.1).** Receives aggregates only: the ledger's format version, counts per operation and event over the last 30 days, and the number of `unknown` outcomes that have not been resolved. Never a `writeId`, `childRef`, `intentRef`, grant reference or app name. A test builds a bundle from a ledger with known refs and asserts none of them appears.
- **Other logs.** stderr diagnostics name the operation, the `writeId` and the event, never an input.

## OAuth write scope

- **Separate scopes.** Each write operation has its own scope named after the operation (`report_absence`), as the stability policy fixes for all scopes. What makes it a write scope is the class, not the name: write scopes are listed apart from read scopes everywhere (tool metadata, consent, dashboard, `/api/v1/session`). One scope per operation rather than one `write` scope, so an app allowed to report absence cannot send messages.
- **Offered only when the deployment allows writes.** The connector offers write scopes only with `SCHOOLSOFT_ALLOW_WRITES` on for that operation. With it off, write scopes are unknown to the authorization server and write tools are never listed.
- **No gain by refresh.** Scopes are fixed when a grant is created; a refresh can only keep or narrow them (today's `exchangeRefreshToken` already selects from the grant's current scopes). A grant created before writes existed, or without a write ticked, never gains one: not by refresh, not by a release, not by the deployment switching writes on. Adding a write means authorising the app again, by step-up (below) or by connecting it again, which creates a new grant through the consent page. E7.6 adds tests for all three.
- **Consent.** Write scopes appear in their own section, "May change things at school", below the reads, each with a sentence saying what it changes, **unticked by default**. The section also holds the owner-channel choice (on by default; opting out is the one choice worded as a warning, see [Who confirms](#who-confirms)) and the write lifetime. A client gets write scopes only if it asked for them and the owner ticked them.
- **Discovery: write scopes stay out of `scopes_supported`.** The specification means `scopes_supported` to be the minimal set, with more scopes requested by step-up, and does not require a server to list every scope it issues. The first draft of this spec advertised write scopes anyway, on the guess that hosts do not step up. The hosts' documentation says the Claude apps and ChatGPT do (below), so E7.6 advertises the read scopes only, and a write scope is requested when a write is first attempted, which also puts its consent next to the request that needed it. Write tools name their scope on the tool (`securitySchemes`, which ChatGPT needs). The authorization server accepts a write scope that a request asks for while writes are on, advertised or not. This rests on HP14 (Claude documents requesting the union of the challenged and the discovery scopes, but not for a scope `scopes_supported` lacks) and HP15. If the probe shows a host that requests only advertised scopes, write scopes go back into `scopes_supported`, unticked at consent, as first drafted.
- **Step-up: two challenges, chosen by the grant's host.** A write call whose grant lacks the scope is answered the way that host documents. The grant knows its host from its registered callback, which the allowlist limits to Claude's and ChatGPT's.
  - **Claude (web, Desktop, mobile):** HTTP `403` with `WWW-Authenticate: Bearer error="insufficient_scope", scope="<the grant's scopes> <operation>", resource_metadata="…"`, the specification's step-up challenge. Claude re-authorises and retries the same call, requesting the union of the challenged and the discovery scopes. The challenge repeats the grant's current scopes because Claude's documentation says scopes from an earlier step-up are not reliably carried forward. The HTTP layer sends it before the MCP SDK runs: a tool result is always a `200`, and Claude does not re-authorise on a `200` with `isError`.
  - **ChatGPT:** a `200` tool result with `isError` and the same challenge (`error`, `error_description`, `scope`) in `_meta["mcp/www_authenticate"]`, with `securitySchemes` on the tool and the protected-resource metadata in place. ChatGPT does not document what it does with an HTTP `403`.
  - **Any other client:** the HTTP `403`, as the specification says.
  - **Claude Code** does not step up. The call fails with a message that the server "needs additional permissions" and to run `/mcp`, and the parent does that to sign in again. It matters only once Claude Code can connect over HTTP (#67, below).

  Re-authorisation leads to the consent page. The requested write is shown with the app's name, still unticked; ticking it creates the new grant. Declining leaves the old grant as it was, and the call fails with the scope error. The new scope comes from consent, never from a refresh.
- **Lifetime.** The grant keeps its 30 days for reads. Its write scopes expire earlier: the owner picks 1, 7 (default) or 30 days at consent (`writeExpiresAt`). After that, refresh issues tokens with the read scopes only and a write call gets the scope challenge. Access tokens stay at five minutes. Pending confirmations bound to a grant die with its write scopes.
- **Revocation.** Disconnecting an app revokes the grant, its tokens and its pending confirmations. The dashboard also gets "Stop changes for this app", which narrows the grant to its reads. Signing out of SchoolSoft revokes every grant, as today. A write in flight when a grant is revoked completes (it cannot be recalled) and is recorded; nothing after it is sent.
- **Per-child grants.** A write covers exactly the grant's children. The child is checked at preview and again at confirm; a child removed from the account in between voids the confirmation. To let an app write for fewer children than it reads, connect it again with fewer children.
- **Format.** `oauth.enc` goes from v1 to v2: grants gain `writeScopes`, `writeExpiresAt` and `ownerConfirms` (true unless the owner opted out at consent). The migration gives existing grants none, so they read exactly as before. Under the stability policy that is a persisted-format change with its migration; the commit body says so.
- **Related: Claude Code's callback and requests without `scope`** ([#67](https://github.com/grimen/schoolsoft-agent/issues/67), found by the probe). The callback allowlist refuses Claude Code's loopback callback, so Claude Code cannot add the connector over HTTP; Claude's own documentation asks servers to accept a loopback redirect for Claude Code on any port (RFC 8252). The connector also refuses an authorization request with no `scope` parameter (`invalid_scope`). Hosts that follow the specification always send one, from the challenge or from `scopes_supported`; Claude Code sends none only when neither gives one, which cannot happen while `scopes_supported` lists the reads. Neither blocks E7.2. E7.6 builds on whatever #67 decides, and step-up from Claude Code is tested once it can connect.

## Budget, errors and live verification

### Request budget and circuit breaker

The budget's write rules (E6.1/E6.2) stay and become the framework's contract:

- A write spends one token like a read, is never retried, is never the half-open probe, and fails fast without being sent while the breaker is open or half-open. It waits at most the budget's usual 10 seconds for a slot; if it cannot start, the outcome is `not_sent` and the claim is released.
- A queued write whose request is cancelled leaves the queue unsent. Once handed to the transport it is never cancelled; it runs to an outcome.
- A 429 or 5xx on a write counts as push-back like any other and makes the outcome `unknown`.
- The reads around a write (session restore, child focus, `intent`, `verify`) are ordinary reads.
- Writes are not given priority or a reserved share. At a parent's pace the budget is never the reason a write waits, and a reserved share would let a write loop spend it.
- Separate from the budget, which protects the portal, the framework limits writes per account to protect the family: at most 10 sends and 30 previews in a rolling 24 hours and 10 previews per minute, counted in the ledger, not configurable in E7.2. Beyond that: `write_limit_reached`. A runaway loop or an injected instruction hits this long before it hits the portal.
- Redirects: a write never re-sends its body. 307 and 308 are never followed. A 301, 302 or 303 after a form post is the usual post-redirect-get pattern; the declaration says whether that means `applied` (redirect back to the form page) or `rejected` (redirect to login), and the redirect is followed as a GET only to decide. Until E6.3 removes `@elias4044/ssp-node`, whose helper re-sends the same method on 301 and 302, `postWrite` keeps redirects off, as today; E6.3 moves the rule into `net.ts`.

### Errors

No new error kind and no new exit code: the stability policy makes both breaking, and the existing kinds fit. Every write error carries `write: { id, outcome }` (MCP `structuredContent.error.write`, REST problem `write`), an added field, so a client can branch on the outcome without reading prose. `outcome` is `not_sent`, `rejected`, `unknown` or `applied`.

| Condition | Kind (exit) | Message key | Retryable | Outcome |
| --- | --- | --- | --- | --- |
| Writes off here, or for this operation | `not_available` (5) | `writes_disabled` | no | `not_sent` |
| Token unknown, expired, spent by another binding, wrong account or operation | `input` (6) | `write_confirmation_invalid` (reason) | no | `not_sent` |
| Intent differs from the preview | `input` (6) | `write_input_changed` | no | `not_sent` |
| Write limit reached | `not_available` (5) | `write_limit_reached` (retry time) | no | `not_sent` |
| Budget refused before sending | `upstream` (7) | `portal_paused`, `portal_slow_down` | yes | `not_sent` |
| No session before sending | `not_authenticated` (2) | existing | no | `not_sent` |
| 401/403 on the send; session renewed, not repeated | `upstream` (7) | `write_not_repeated` | no | `rejected` |
| Other 4xx, or a redirect the declaration reads as refused | `upstream` (7) | `write_rejected` (status) | no | `rejected` |
| 5xx, 429, timeout, network failure after the request left | `upstream` (7) / `network` (4) | `write_outcome_unknown` | no | `unknown` |
| 2xx whose body does not map | none: success | | | `applied`, `receipt: null` |

The last row matters: a write the portal accepted is never reported as a failure. A `ResponseDriftError` from a write's response would tell the user nothing happened when it did, so drift in a write receipt is logged and recorded, and the result says the receipt could not be read. `absence_rejected` becomes the generic `write_rejected`; message keys are internal. REST problem types for E7.6 are new types (compatible): `write-confirmation` (409), `write-input-changed` (409), `write-limit` (429), `write-rejected` (422), `write-outcome-unknown` (502).

### Verification

Offline, to 100% coverage with fakes against the ports: declarations and derived annotations; token binding, expiry, replay, voiding on changed input; the claim across two spawned processes racing one token (exactly one send); released claims; the `sending`-to-`unknown` recovery; the duplicate warning; limits; the budget interplay with the fake clock; OAuth v1→v2 migration, no gain by refresh, write expiry narrowing; consent and owner-channel pages in real Chromium (`test/e2e-hosts`), since offline tests set `Origin` themselves (#58); the audit redaction test (a ledger written from inputs containing known names and text, then searched for them); the bundle test. Body mappers are tested against the form fixtures the capture probe records (E2.1): action, method, field names, choices, never values.

Live, only in the E2 session, never in CI, never from `make e2e`: one real write per capability, made for a real need with the guardian's consent (E2.4's rule for absence, extended). A local target, `make write-acceptance OP=<operation>`, previews, shows the preview, takes the maintainer's confirmation and records the request shape and the portal's answer redacted fail-closed by the capture probe's redactor. The boundary test keeps write capabilities out of every other e2e suite.

## Migration of `report_absence` and `allowWrites`

- **`allowWrites` keeps its name, sources, meaning and default** (off, and never turned on by a release, per the stability policy). It additionally accepts a list of operation names (`"allowWrites": ["report_absence"]`, `SCHOOLSOFT_ALLOW_WRITES=report_absence,send_message`); accepting more values is compatible. Enforcement moves from the operation into the framework and, as defence in depth, into the provider: `ApiPortalContext` carries the allowed write capabilities and a write capability not in it throws before building a request. That settles the principle the absence spec bent.
- **The connector reads the same setting.** It has never offered a write, so switching it on widens no existing grant.
- **`report_absence` keeps its name, CLI command, inputs and annotations.** New optional input `confirmation`. Its output stays untyped (not a contract) and gains `write_id`, `confirmation` and `expires_at`; `status` keeps `preview` and `reported`. Typing the output waits for E2.4, when the portal's answer is known.
- **`confirm: true` changes meaning, and that is marked breaking.** Today one call with `confirm: true` sends without a preview ever having been shown. Under the framework the same call returns a preview and a token. A call that used to send and now does not is a breaking change; it is made without a deprecation period under the stability policy's security exception, because a one-call write is exactly how an injected instruction would write. E7.2 carries `!` and a `BREAKING CHANGE:` footer naming `confirmation` as the replacement. `confirm` itself stays accepted and ignored, its description starting "Deprecated: use confirmation", for one released minor; its removal is a later breaking change.
- **Messages and hints.** `confirm_again` and `check_portal` are reworded around `confirmation` and `write_log` (wording is not a contract).
- **Persisted state.** `writes.json` and `writes.enc` are new files at v1; `oauth.enc` v1 → v2 as above.

## Threat model

| Threat | Mitigation | Residual risk |
| --- | --- | --- |
| **Prompt injection causing writes.** Text from the portal (messages, news, assignment and calendar text, activity log) reaches the model and tells it to report an absence or send a message, possibly carrying the child's data to a recipient | Writes off by default, per operation; no one-call write; the preview names every field, recipient and body; the owner channel by default on the connector, elicitation where a host is seen to support it; write limits; duplicate warnings; recipients only from the portal's own list (E7.4); audit shows every preview, so previews nobody asked for are visible | With token-only confirmation (the local surfaces, or a connector grant the owner opted out of the owner channel) and a host set to "Always allow", an injected model can preview and confirm. The limits bound the damage, and the audit shows it afterwards. Documented, not solved |
| **Malicious third-party client.** An app the parent connected, or a page that registered with the connector's own callback, asks for write scopes | Registration accepts only the known callbacks; consent names the app and its return address; write scopes not advertised, unticked by default, per operation, short-lived; owner channel on by default per grant; per-grant limits; revocation | A client the parent approved with writes and opted out of the owner channel can write within its scopes until they expire or are revoked |
| **Replay.** A captured confirm request or token is sent again | Single use, atomic claim; replay from the same binding gets the recorded outcome and sends nothing; from any other binding it is refused; tokens stored only as keyed hashes; 10-minute expiry | None known |
| **CSRF on the owner pages.** A cross-site form confirms a pending write or approves a write scope | Owner POSTs require `Origin` equal to the public URL, the CSRF token and the `SameSite=Strict` `__Host-owner` cookie; confirm is POST only; `frame-ancestors 'none'`; the page shows the preview from the server's record, never from the URL, and expects to arrive from the host's link without the cookie (HP17), so it asks for sign-in and never acts on the arriving GET. The Origin check only works in real browsers with `Referrer-Policy: same-origin` (#58); E7.6 depends on it and adds a Chromium test of the arrival and the confirm post | A parent who clicks Confirm on a genuine page for a write they did not ask for. The page says which app asked, when, and what |
| **Stolen token.** Access token (5 min), refresh token, confirmation token, owner cookie, or the state directory | Access: short-lived, bound to one grant, write scopes expire and can be dropped. Refresh: rotation with reuse detection revokes the grant. Confirmation token: useless without an access token of the same grant and the identical input. Owner cookie: `httpOnly`, 30 minutes, `SameSite=Strict`. All writes audited | A thief with a live access token and refresh token of a grant with writes that opted out of the owner channel can write until the write lifetime ends or the parent revokes. Whoever holds the local state directory holds the SchoolSoft session anyway |

</frozen-after-approval>

## Left for later stories

- **E7.2**: `src/core/writes/` (types, canonical intent hash, token, ledger port with the file and encrypted implementations, lock, limits, `runWrite` behind `runOperation`), derived annotations and `WRITE_CAPABILITIES`, the `confirmation` input and flag, `write_log`, the new message keys in English and Swedish, the provider-level switch, form elicitation on the local MCP server (2025-11-25 on the pinned SDK, behind the ask-the-person port, only for hosts on the observed list; see [MCP protocol revision](#mcp-protocol-revision)), `report_absence` moved onto it with the breaking marker, docs and skills regenerated.
- **E7.3 and E7.4**: the leave and message declarations (payload, preview, `repeat`, `reversibility`, `verify`), their body mappers from the E2.1 form fixtures, whether they post over HTTP or need the browser session with a per-call write allowance, the redirect reading, then the live pass. E7.4 also decides how recipients are chosen from the portal's list.
- **E7.5**: the booking-response declaration (`repeat: "same_state"` if the live pass agrees).
- **E7.6**: write scopes in `oauth.enc` v2, consent section, dashboard "Recent changes", "Stop changes for this app", the owner channel (`/owner/writes/<writeId>`) on by default with the per-grant opt-out and a page that expects to arrive without the owner cookie, write tools listed by scope on `/mcp` with `securitySchemes`, read scopes only in `scopes_supported`, both scope challenges chosen by the grant's host (HTTP `403` and `_meta["mcp/www_authenticate"]`), REST write routes (`POST …/children/{childId}/<target>/preview`, `POST …/children/{childId}/<target>`, `GET /api/v1/writes/{writeId}` for the creating grant), their problem types, and `/api/v1/session` listing write routes separately.
- **E10.1**: consumes the aggregate contract above.

## Open questions for the live session (E2)

| Question | Why it matters |
| --- | --- |
| The absence endpoint's body, success status and response, part-day semantics, redirects on a dead session, and whether it needs the app or the web session (E2.4) | The first declaration's payload, `session` and redirect reading |
| What a duplicate absence report, leave application or booking answer does: registered twice, replaced, refused | `repeat` for each declaration, and so the duplicate warning's wording |
| Whether each write can be undone by the guardian (withdraw an absence or leave application, change a booking; a sent message surely not) | `reversibility`, and so `destructiveHint` |
| Whether the portal lists what was written (reported absences, submitted applications, sent messages, the chosen slot) and how soon | Whether `verify` is possible for each |
| Whether leave, message and booking are JSP form posts only, and whether those forms carry a portal CSRF token or a one-time field | HTTP post versus browser session; how a body is built |
| What a POST gets on an expired session: 401, a redirect to login, or a 200 login page | Telling `rejected` from `unknown` |
| How long a write takes to answer | The 30-second write timeout |
| Whether a guardian can send a message to themselves, or to whom a live test message can go | A safe live test for E7.4 |
| Whether the portal limits writes separately from reads | The write limits above |

The host question that stood in this table (elicitation, step-up, prompts and "Always allow" on Claude and ChatGPT) needs no SchoolSoft and moved to the host probe, below; the runbook's W8 moves with it.

## Host questions (host-capability probe, #66)

The probe answers these without SchoolSoft or BankID. "Documented" is what the specification and the hosts' pages said on 2026-09-26 (`docs/development/host-probe.md`, #66). "Still open" is what only the probe's run against the real hosts can settle; its results go in that guide's observed table.

| Question | Probe | Documented | Still open | What it decides |
| --- | --- | --- | --- | --- |
| Which elicitation modes each host declares, and whether form elicitation is shown and answers accept, decline and cancel | HP1, HP2 | Claude apps: not documented, open request. Claude Code: form and URL. ChatGPT: recommended, no mode named. Claude Desktop, local: reported declared but never shown | All of it, per host and platform | The elicitation list; whether any remote host gets form elicitation |
| Whether URL elicitation shows the full URL, asks before opening and opens it; `-32042` | HP3, HP4 | As HP1; `-32042` documented by no host and removed in 2026-07-28 | HP3 per host | Whether the owner link can go as URL elicitation instead of text |
| Whether a host asks before read-only and open-world reads | HP5, HP6 | Claude and ChatGPT: no prompt for read-only; open world not documented | HP6 | Nothing in this spec; reads only |
| Whether a host asks before a non-destructive write and before `destructiveHint: true`, and with what wording | HP7, HP8 | ChatGPT: any tool without `readOnlyHint`. Claude: destructive tools "always prompt"; non-destructive writes not documented | Claude HP7; the wording on both | Nothing that carries safety ([Host prompts and annotations are not a control](#host-prompts-and-annotations-are-not-a-control)) |
| Whether "Always allow" is offered for those, and for how long | HP9 | Offered by both. Claude's contradicts "always prompt"; ChatGPT's sources disagree on conversation versus for good | What actually happens | As above; documentation of the residual risk |
| How a preview result shows, and whether the model confirms without asking | HP10, HP11 | Not documented | Both | The preview text and the model instructions |
| Which scopes a host requests on first connect | HP12 | Claude: the challenge's scope, else `scopes_supported` plus `offline_access`. Claude Code: the challenge's or the resource metadata's scope. ChatGPT: no rule stated | ChatGPT; confirming the others | #67's missing-`scope` decision |
| Re-authorisation on HTTP `403 insufficient_scope`, for an advertised and for an unadvertised scope | HP13, HP14 | Claude apps: yes, retries, union of scopes; unadvertised not stated. Claude Code: no, run `/mcp`. ChatGPT: not documented | HP14 for the Claude apps; HP13 and HP14 for ChatGPT | Whether write scopes stay out of `scopes_supported` |
| Re-authorisation on the `_meta["mcp/www_authenticate"]` tool-result challenge | HP15 | ChatGPT: yes, with `securitySchemes`. Claude: no for a `200` with `isError` | ChatGPT observed | The ChatGPT half of step-up |
| Whether the MCP session survives re-authorisation | HP16 | Not documented; 2026-07-28 has no protocol sessions | Observe | Nothing: confirmations bind to the grant |
| Whether the owner's `SameSite=Strict` cookie arrives on a link the host opens | HP17 | Expected no (browser rule) | Confirm | The owner page's arrival step |
| Which protocol revision a host asks for, and whether it sends per-request capabilities | HP18 | Claude Code's v2 runtime: 2026-07-28. Others: not documented | All hosts | E7.2's re-check before choosing the SDK |
| Mobile | Mobile row | Claude: remote connectors work in the phone apps; adding them there is in beta. ChatGPT: custom MCP apps web only | Whether prompts and elicitation differ on the phone | Nothing new if the owner channel is the default |
| Claude Code using a connector inherited from claude.ai: which OAuth client, and how step-up behaves | Not in the probe | Available with a claude.ai login; step-up not documented | Observe | Whether Claude Code can write through the connector before #67 |

## Verification

Spec only. `make docs-check` passed. `make format-check` fails on `main` for `.release-please-manifest.json` until #55 merges; this change touches only Markdown.

Updated with the host findings from #66: `make docs-check` and `make format-check` passed. The MCP specification pages, the Claude and Claude Code connector pages, OpenAI's developer-mode and authentication pages, anthropics/claude-ai-mcp#153 and anthropics/claude-code#96043 were re-read on 2026-09-26 where this spec relies on them.
