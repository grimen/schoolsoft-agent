---
title: Parent-hosted MCP connectors
type: feature
created: 2026-09-07
status: done
route: dispatch
baseline_commit: ac8d70e19d8e4355c3a5efcbed7160274859a1bd
context:
  - AGENTS.md
  - docs/architecture.md
---

# Parent-hosted connectors

The user authorized all implementation, testing and review phases before their review.

<frozen-after-approval>

## Intent

Parents can run a private, single-guardian MCP service in their own hosting account and authorize Claude or ChatGPT independently. The maintainer operates no service. Setup and recovery instructions must work for beginners. Existing local MCP and skill hosts keep working.

## Boundaries

Streamable HTTP with OAuth discovery, PKCE and dynamic client registration. Explicit owner approval restricts each grant to children and read capabilities: child listing, schedules and lunch menus. Sensitive browser-session capabilities and writes remain unavailable remotely. Manual BankID completes the upstream login. Runtime pins the first guardian identity and serializes upstream operations. Credentials and grant state use authenticated encryption with a key supplied separately from the persistent disk. No secrets or child data appear in logs.

Live compatibility with SchoolSoft accepting a public HTTPS callback and real Claude/ChatGPT account consent cannot be proved offline. Ship truthful release-candidate instructions and a human acceptance checklist; never call mocks live verification. No deployment or real BankID interaction occurs during implementation.

## I/O and edge cases

| Input or condition | Required behavior |
| --- | --- |
| Invalid URL, short secrets, invalid port | Startup fails without printing secrets |
| Missing/invalid bearer | MCP refuses with discovery challenge |
| Unapproved callback or scope | OAuth refuses |
| Valid code with PKCE | One token exchange for matching client, redirect and resource |
| Expired/replayed code or refresh | Refuse; refresh replay revokes grant |
| Owner approval | Bind chosen tools and children to grant |
| CSRF, wrong password or expired owner cookie | No owner mutation |
| Wrong/expired/replayed BankID callback | No authenticated session |
| Different guardian signs in | Clear attempted session and refuse identity change |
| Concurrent child reads | Serialized focus and data retrieval |
| Unselected child or hidden tool | Refuse before upstream read |
| Revocation during queued read | Do not return data under revoked grant |
| Restart | Recover encrypted state; transient login and owner sessions expire |
| Corrupt ciphertext | Fail closed |
| Hostile HTML input | Escaped output, restrictive headers |

</frozen-after-approval>

## Code Map

- `src/http/`: remote transport, owner console, OAuth provider, encrypted state, runtime and configuration.
- `src/core/provider/types.ts`, `src/core/wiring.ts`, provider browser flow: injected remote callback preserves local default and PKCE.
- Registry remains the sole definition of MCP tools; HTTP selects a subset.
- `test/unit`, `test/functional`, `test/packaging`: isolated auth/runtime cases, real HTTP protocol and deployment checks.
- Docker/Compose/Render artifacts plus `docs/hosts`: parent-owned deployment and host support matrix.

## Tasks & Acceptance

- [x] Remote browser callback seam. Given a remote flow, when BankID completes, then provider exchanges its original PKCE verifier without starting a localhost server.
- [x] OAuth service. Given a registered client, when owner approves selected children/scopes, then only that grant authorizes tools; expiry, revocation and replay fail closed.
- [x] Parent console and encrypted state. Given a parent-owned HTTPS origin, when configured, then owner setup, login, consent and revoke use authenticated sessions and CSRF protection.
- [x] HTTP MCP. Given a valid grant, when tools are listed/called, then only permitted registry operations and children are accessible and concurrent calls cannot mix child focus.
- [x] Deployment and guidance. Given a parent without an agent installation, when following the guide, then required accounts, costs, secrets, checkpoints, recovery and removal are explained concretely.
- [x] Verification and review. Automated coverage includes all new executable modules; full repository gates and packaged tests pass. Independent review findings are resolved before handoff.

## Implementation Notes

Initial local docs edits predate this implementation and are preserved. Work branch: `feat/parent-hosted-connectors`. Auth, runtime and packaging were assigned bounded ownership during investigation. No deployment is requested.

## Spec Change Log

None.

## Review Triage Log

| Finding | Verdict and evidence | Resolution |
| --- | --- | --- |
| Blind: refresh history exhausts capacity | medium: five-minute rotations retain thirty-day history | Authenticated rotating refresh tokens with bounded current state and lifetime test |
| Blind: revoked grants consume slots | medium: approval counted revoked entries | Delete revoked grant credentials and test repeated reconnect |
| Blind: global owner throttle locks out parent | medium: all callers shared five attempts | Bounded per-client buckets; forwarded-client isolation test |
| Blind: proxy callers share OAuth limits | medium: no trusted proxy boundary was configured | Explicit bounded proxy-hop setting, one hop for shipped templates |
| Blind: queued revoked requests still read | high: permission check preceded runtime queue | Check authorization inside queue and before reads |
| Blind: unbounded queued reads | medium: requests could accumulate without limit | Sixteen-call admission cap and AbortSignal guards |
| Blind: revocation not crash durable | medium: rename alone lacked filesystem flush | Flush file and directory before acknowledging mutations; ordering test |
| Blind: no owner-only signout | medium: management session could not be ended independently | CSRF-protected current-session logout and cookie clearing |
| Blind: dashboard omits approved children | medium: only scopes were rendered | Approved child labels and expiry displayed |
| Blind: late login failures disappear | medium: URL promise already resolved | Safe outcome enum displayed on dashboard |
| Edge: recovery selects unapproved sibling | high: same-guardian retry could change child focus | Validate/refocus original child before recovery retry and validate result focus |
| Edge: revoked grant capacity | medium: independently confirmed duplicate | Same grant removal fix |
| Edge: capacity consumes refresh token | medium: mutation occurred before issuance completed | Transactional issuance keeps prior credential valid on failure |
| Edge: child-isolation claim | high: same recovery gap independently confirmed | Same recovery guard and regression test |
| Verification: response payload unasserted | medium: success tests could pass with empty JSON | Assert decoded successful MCP result |
| Verification: global logout token revocation unasserted | medium: endpoint tested without issued grants | Issue two grants then check access and refresh rejection after logout |


## Verification

- `make check`: passed; 260 tests, no skips, 100% statements, branches, functions and lines. HTTP implementation is included; executable entrypoints have explicit packaged-binary coverage rather than the previous blanket index exclusion.
- `make check-ci`: shellcheck and actionlint passed.
- `make e2e-artifact`: 11 tests passed, no skips; local MCP, CLI, skill and browser extractor artifacts remain compatible.
- `docker build -f Dockerfile.connector -t schoolsoft-connector:review .`: passed.
- `node test/packaging/connector-container.mjs`: passed with no network, fresh root-owned disk, UID 1000, no runtime capabilities, encrypted persistence, restart and clean shutdown.
- Independent review: three reviewers; all sixteen findings addressed, including duplicates. Follow-up review confirmed recovery isolation and bounded HMAC refresh rotation fixes with no remaining confirmed issues.
- Optional external `skills-ref` executable was unavailable; the repository's own manifest and skill checks passed.

The I/O matrix is covered across `http-basics.test.ts`, `http-durability.test.ts`, `http-oauth.test.ts` (unit and HTTP), `http-runtime.test.ts`, `http-owner.test.ts`, `http-start.test.ts` and connector packaging tests. Live SchoolSoft public callback registration, BankID completion, vendor account/UI availability and phone access require the manual acceptance checklist in the parent guide. No live guardian credentials, deployment, or vendor connections were used. Offline tests do not certify legal compliance.

The experimental connector storage format is new in this branch. Do not reuse scratch OAuth state from intermediate development builds. Existing local session files are unchanged.
