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
  - https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation
  - https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization
---

# Write framework (E7.1)

`report_absence` (#21) carries a small gate of its own: `allowWrites` off by default, a preview unless `confirm: true`, never repeated. That is enough for one write. Leave applications (E7.3), messages (E7.4) and booking answers (E7.5) are coming, and the connector and REST surface will offer writes to AI apps and custom UIs (E7.6). This spec defines the one mechanism all of them use: how an operation declares a write, how a preview becomes a confirmed send, how a send happens at most once, what is recorded, and how a remote app gets permission to write. It is a spec only. E7.2 builds it and moves `report_absence` onto it. Nothing here was run against SchoolSoft.

<frozen-after-approval>

## Intent

Every write goes through the same five steps on every surface: **gate** (writes allowed here, for this operation, for this caller), **preview** (the exact change in human terms, nothing sent), **confirm** (a single-use token bound to that exact change), **send** (exactly one request, never retried) and **record** (an outcome and an audit entry that hold no child data). An operation declares what it writes; the framework owns every step around it, so a new write is one file and one registry line, like a read.

What the framework can promise, on every surface: nothing is sent without a preview of the identical change within the last 10 minutes; one confirmation sends at most once; a write stays inside the caller's grant; every attempt is recorded. What it cannot promise everywhere is that a human, not the model, gave the confirmation. The section [Who confirms](#who-confirms) says exactly where that holds and where it does not.

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

Rules the boundary test enforces: an operation that lists a capability in `WRITE_CAPABILITIES` declares `writes`, and one that declares `writes` lists exactly one such capability, used only by `send`. `WRITE_CAPABILITIES` is derived from the declarations instead of kept by hand. Annotations are derived, not written: `readOnly: false`, `idempotent: false`, `destructive: reversibility !== "reversible"`. The framework adds one input to every write operation, `confirmation` (string, optional; CLI `--confirmation`), and leaves it out of the hash.

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

The confirmation token travels through whatever called the preview. For an AI app that is the model, so a model can in principle preview and confirm in two calls without anyone reading the preview. Hosts do ask before tools that are not read-only (Claude's per-tool "Needs approval"; ChatGPT asks depending on the tool's annotations and the app's permissions), but a user can switch that to "Always allow", and the MCP specification calls annotations untrusted hints that servers must not rely on. The server cannot see which happened. So the framework adds stronger channels where a surface has one, and says plainly where it has none:

| Surface | How confirmation arrives | What the server can prove | What it cannot |
| --- | --- | --- | --- |
| CLI (and the skill that drives it) | `--confirmation <token>` | identical change, previewed, once, in time | that a person read it. A TTY is not a person (see the stability policy on JSON output); the agent host's own command approval is the human step |
| Local MCP (stdio) | host supports form elicitation: the server asks for a yes/no in the host's own dialog during the call, and no token is returned. Otherwise the token in `confirmation` | with elicitation, that a conforming host showed the preview to the user, because the answer comes from the host's UI and not from the model | that the host conforms; a host that lets the model answer elicitations defeats it |
| Connector MCP | as local MCP, plus an **owner channel** the parent can require per grant: the tool answers "waiting for your confirmation" with a link to `/owner/writes/<writeId>` (as a URL-mode elicitation where the host supports it, as text otherwise); the parent confirms there, signed in with the owner password, and the connector sends from that page | with the owner channel, that someone holding the owner password saw the preview on the connector's own page and clicked Confirm | nothing further; this is the strongest channel. Without it, as local MCP |
| REST (custom UIs, the app) | `confirmation` in the confirm request, or the owner channel as above | as CLI; the UI is trusted to have shown the preview, and the consent page says so | that the UI showed it |

Decisions:

- **Elicitation is preferred when the client declares it.** The MCP 2026-07-28 specification carries elicitation as an `input_required` result that the client answers on a retried call; 2025-11-25 as a server request. E7.2 uses whichever the pinned SDK supports. The form has one boolean field ("Send this?") and the preview as its message; it asks for no secret, as the specification requires. Decline or cancel records `not_sent`.
- **The owner channel is off by default** and chosen per grant on the consent page ("Each change also needs my confirmation on this dashboard"). It is strong but costly: it needs the owner password, whose session lasts 30 minutes. With it on, the pending record keeps the preview, encrypted in the connector's store, until it is confirmed, cancelled or expired.
- **The preview's text tells the model what to do.** Show the preview to the user, confirm only after they say yes, never on its own, never after an error. That is advice to the model, not a control, and the documentation does not present it as one.

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

- **Separate scopes.** Each write operation has its own scope named after the operation (`report_absence`), as the stability policy fixes for all scopes. What makes it a write scope is the class, not the name: write scopes are listed apart from read scopes everywhere (metadata, consent, dashboard, `/api/v1/session`). One scope per operation rather than one `write` scope, so an app allowed to report absence cannot send messages.
- **Offered only when the deployment allows writes.** The connector offers write scopes only with `SCHOOLSOFT_ALLOW_WRITES` on for that operation. With it off, write scopes are unknown to the authorization server and write tools are never listed.
- **No gain by refresh.** Scopes are fixed when a grant is created; a refresh can only keep or narrow them (today's `exchangeRefreshToken` already selects from the grant's current scopes). A grant created before writes existed, or without a write ticked, never gains one: not by refresh, not by a release, not by the deployment switching writes on. Adding a write means connecting the app again, which creates a new grant through the consent page. E7.6 adds tests for all three.
- **Consent.** Write scopes appear in their own section, "May change things at school", below the reads, each with a sentence saying what it changes, **unticked by default**. The section also holds the owner-channel choice and the write lifetime. A client gets write scopes only if it asked for them and the owner ticked them.
- **Discovery.** While writes are on, write scopes are in `scopes_supported`, so Claude and ChatGPT (which request the advertised scopes) bring them to the consent page, where they stay unticked unless chosen. A write call without the scope answers `403` with `WWW-Authenticate: Bearer error="insufficient_scope", scope="<operation>"`, the MCP 2026-07-28 step-up challenge, for clients that re-authorize on it. The specification asks for a minimal `scopes_supported`; this deviates on purpose until the live session shows whether the hosts step up (open question).
- **Lifetime.** The grant keeps its 30 days for reads. Its write scopes expire earlier: the owner picks 1, 7 (default) or 30 days at consent (`writeExpiresAt`). After that, refresh issues tokens with the read scopes only and a write call gets the scope challenge. Access tokens stay at five minutes. Pending confirmations bound to a grant die with its write scopes.
- **Revocation.** Disconnecting an app revokes the grant, its tokens and its pending confirmations. The dashboard also gets "Stop changes for this app", which narrows the grant to its reads. Signing out of SchoolSoft revokes every grant, as today. A write in flight when a grant is revoked completes (it cannot be recalled) and is recorded; nothing after it is sent.
- **Per-child grants.** A write covers exactly the grant's children. The child is checked at preview and again at confirm; a child removed from the account in between voids the confirmation. To let an app write for fewer children than it reads, connect it again with fewer children.
- **Format.** `oauth.enc` goes from v1 to v2: grants gain `writeScopes`, `writeExpiresAt` and `ownerConfirms`. The migration gives existing grants none, so they read exactly as before. Under the stability policy that is a persisted-format change with its migration; the commit body says so.

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
| **Prompt injection causing writes.** Text from the portal (messages, news, assignment and calendar text, activity log) reaches the model and tells it to report an absence or send a message, possibly carrying the child's data to a recipient | Writes off by default, per operation; no one-call write; the preview names every field, recipient and body; elicitation or the owner channel where available; write limits; duplicate warnings; recipients only from the portal's own list (E7.4); audit shows every preview, so previews nobody asked for are visible | With token-only confirmation and a host set to "Always allow", an injected model can preview and confirm. The limits bound the damage, and the audit shows it afterwards. Documented, not solved |
| **Malicious third-party client.** An app the parent connected, or a page that registered with the connector's own callback, asks for write scopes | Registration accepts only the known callbacks; consent names the app and its return address; write scopes unticked by default, per operation, short-lived; owner channel per grant; per-grant limits; revocation | A client the parent approved with writes and no owner channel can write within its scopes until they expire or are revoked |
| **Replay.** A captured confirm request or token is sent again | Single use, atomic claim; replay from the same binding gets the recorded outcome and sends nothing; from any other binding it is refused; tokens stored only as keyed hashes; 10-minute expiry | None known |
| **CSRF on the owner pages.** A cross-site form confirms a pending write or approves a write scope | Owner POSTs require `Origin` equal to the public URL, the CSRF token and the `SameSite=Strict` `__Host-owner` cookie; confirm is POST only; `frame-ancestors 'none'`; the page shows the preview from the server's record, never from the URL. The Origin check only works in real browsers with `Referrer-Policy: same-origin` (#58); E7.6 depends on it and adds a Chromium test of the confirm post | A parent who clicks Confirm on a genuine page for a write they did not ask for. The page says which app asked, when, and what |
| **Stolen token.** Access token (5 min), refresh token, confirmation token, owner cookie, or the state directory | Access: short-lived, bound to one grant, write scopes expire and can be dropped. Refresh: rotation with reuse detection revokes the grant. Confirmation token: useless without an access token of the same grant and the identical input. Owner cookie: `httpOnly`, 30 minutes, `SameSite=Strict`. All writes audited | A thief with a live access token and refresh token of a grant with writes and no owner channel can write until the write lifetime ends or the parent revokes. Whoever holds the local state directory holds the SchoolSoft session anyway |

</frozen-after-approval>

## Left for later stories

- **E7.2**: `src/core/writes/` (types, canonical intent hash, token, ledger port with the file and encrypted implementations, lock, limits, `runWrite` behind `runOperation`), derived annotations and `WRITE_CAPABILITIES`, the `confirmation` input and flag, `write_log`, the new message keys in English and Swedish, the provider-level switch, elicitation on the local MCP server, `report_absence` moved onto it with the breaking marker, docs and skills regenerated.
- **E7.3 and E7.4**: the leave and message declarations (payload, preview, `repeat`, `reversibility`, `verify`), their body mappers from the E2.1 form fixtures, whether they post over HTTP or need the browser session with a per-call write allowance, the redirect reading, then the live pass. E7.4 also decides how recipients are chosen from the portal's list.
- **E7.5**: the booking-response declaration (`repeat: "same_state"` if the live pass agrees).
- **E7.6**: write scopes in `oauth.enc` v2, consent section, dashboard "Recent changes", "Stop changes for this app", the owner channel (`/owner/writes/<writeId>`), write tools listed by scope on `/mcp`, the scope challenge, REST write routes (`POST …/children/{childId}/<target>/preview`, `POST …/children/{childId}/<target>`, `GET /api/v1/writes/{writeId}` for the creating grant), their problem types, and `/api/v1/session` listing write routes separately.
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
| Do Claude and ChatGPT (web and mobile) support form and URL elicitation on a remote connector, re-authorize on `insufficient_scope`, and prompt for tools marked `destructiveHint: true`; is "Always allow" offered for them | Which channels are real on each host; whether write scopes can leave `scopes_supported` |
| Whether a guardian can send a message to themselves, or to whom a live test message can go | A safe live test for E7.4 |
| Whether the portal limits writes separately from reads | The write limits above |

## Verification

Spec only. `make docs-check` passed. `make format-check` fails on `main` for `.release-please-manifest.json` until #55 merges; this change touches only Markdown.
