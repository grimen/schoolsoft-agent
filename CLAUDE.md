# schoolsoft-mcp-server — project context

Unofficial MCP server (TypeScript, stdio) for SchoolSoft, targeting parents
("vårdnadshavare") in municipalities like Täby where login is BankID.
Goal: seamless read/write access from Claude/ChatGPT/other MCP clients.

## Architecture decisions (already made)

- **API layer: own `src/api/guardian.ts`**; `@elias4044/ssp-node` (MIT) is
  kept only for its HTTP helpers and as the token/cookie holder — every
  data and auth endpoint it ships is student-only (see Live findings). Alternatives evaluated and rejected:
  - `kanylbullen/schoolsoft-mcp` (Python MCP, HTML scraping, password-only
    auth, most tools "experimental") — used as functional spec only.
  - `CarelessInternet/node-schoolsoft` — untested for guardian accounts.
  - `jojomondag/ApiForge` (no license) — its session-persistence pattern
    inspired ours; its HAR-record+LLM-analyze method is the plan for
    mapping unknown write endpoints.
- **Auth: interactive-first.** BankID must never be automated. The
  `schoolsoft_login` tool opens the real SchoolSoft login page in the
  user's browser (OAuth2+PKCE via `src/auth/oauth.ts`, client id vApp, with
  a `http://127.0.0.1:43117/callback` redirect), captures the code on a
  one-shot local HTTP server, exchanges for access+refresh tokens.
- **Session persistence:** AES-256-GCM blob in `~/.schoolsoft-mcp/`
  (key file 0600). `ensureSession()` in `src/services/client.ts` silently
  restores → refreshes → exchanges token for cookies → verifies, and
  throws `NotAuthenticatedError` with agent-actionable guidance otherwise.
- **Server:** `@modelcontextprotocol/sdk` `McpServer` + `registerTool`,
  Zod schemas, `structuredContent` responses, stdio transport.
- **SOLID refactor (done):** auth methods live behind the `AuthStrategy`
  interface (`src/auth/strategy.ts`); `BankIdBrowserStrategy` is the first
  implementation, and the planned fallbacks become new classes registered
  in `src/services/wiring.ts` — no edits to existing code. All lifecycle
  state lives in the `SessionManager` class (`src/services/session-manager.ts`)
  with constructor-injected `SessionStore` + client factory. Production
  wiring (env vars, FileSessionStore, strategy list) is isolated in
  `wiring.ts`; tests construct SessionManager directly with
  `MemorySessionStore` and fakes — see `test/session-manager.test.ts`
  (6 passing, `npm test`, zero disk/network).

## Live findings (Täby, guardian account, 2026-09-06) — ALL ANSWERED

E2E: 14/14 green against real SchoolSoft (`SCHOOLSOFT_SCHOOL=taby npm run test:e2e`),
including forced token refresh, cold subprocess restore, and child switching.

1. **Localhost redirect_uri: accepted.** Code arrives at
   `http://127.0.0.1:43117/callback`. No fallback strategy needed.
2. **Guardian login = parent route + client_id `vApp`.** SchoolSoft stamps
   `user_type` into the JWT from the *client id* (eApp → STUDENT, vApp →
   PARENT), and resolves the user at use time, so a wrong client id yields a
   token that fails everything with "Vi kunde inte hitta användaren". The
   login route (`#/login/parent`) must match too. orgid is irrelevant for
   SAML/BankID. Täby: slug `taby`, BankID via Täby's SAML IdP
   (`etjanst.taby.se`); "Åtkomst från app" was already enabled.
3. **Multi-child: `/eva/api/v1/parent` lists children** (2 here, same
   school, orgId 20). The webview cookie session is bound to one child
   (`childInFocus` header on the exchange); tools take `child_id` and
   re-exchange when it changes. Persisted as `guardian` in the session.
4. **Lifetimes:** access token 15 min (JWT `exp`; token response has no
   `expires`, so we persist the JWT exp). Refresh grant works and rotates
   the refresh token; refresh-token lifetime still unknown — D3 snapshots
   accumulate in e2e-report.md across days.

**Data layer (ssp-node is student-only; we use it for HTTP helpers only):**
- Eva, Bearer: `/eva/api/v1/parent`, `/eva/api/v1/schools/{org}/lunchmenu/{week}`,
  `/eva/api/v2/parent/{uid}/schools/{org}/news?studentId=`,
  `/eva/api/v1/parent/{uid}/schools/{org}/messages/inbox|{id}`,
  `.../news/calendarevent/next`. 404: `.../student/{sid}/lessons`, `.../badge`.
- Webview REST, cookies: `/rest-api/session`, `/rest-api/parent/calendar/lessons/week/{w}`,
  `/rest-api/parent/ps/assignments/start-page?week=&year=`, `.../assignments/{id}/view|sections`.
- Cookie exchange: `/eva-apps/auth/login/parent` with headers
  `token, userId, orgId, childInFocus, userOS, language, redirecturl`.
- Reference implementation for more endpoints (holistic assessments,
  plannings, staff, profile updates): sebdanielsson/better-schoolsoft (MIT).

## Roadmap

- [x] Live-test auth flow end to end (all four questions answered above)
- [x] `schoolsoft_get_messages` / `schoolsoft_get_message` (Eva inbox)
- [x] Multi-child: `schoolsoft_list_children` + `child_id` on read tools
- [ ] **Write ops (the differentiator, nothing open source has these):**
      `schoolsoft_report_absence`, `schoolsoft_send_message`,
      `schoolsoft_apply_leave`, respond to bookings. Map via HAR
      (log in via browser devtools → record the action → replay with
      session cookies). Mark all with destructiveHint and require
      explicit user confirmation in tool descriptions.
- [ ] Write ops mapping: start from better-schoolsoft's endpoint list, then HAR
- [ ] `schoolsoft_find_school` — resolve school name → slug via the public
      3414-school list so parents at any school can configure without knowing the slug
- [ ] Evals per mcp-builder methodology (10 read-only Q&A pairs)
- [x] Test pyramid:
      * Unit (`session-manager`, `file-store`, `browser-flow`): logic,
        crypto fail-closed behavior, real-localhost callback server incl.
        CSRF/state, port conflicts. Zero network beyond 127.0.0.1.
      * Functional (`functional.test.ts`): real MCP Client ↔ McpServer
        over InMemoryTransport — tool listing/annotations, Zod validation,
        auth guard, structuredContent, logout invalidation. SchoolSoft
        itself is a fake injected via SessionManager.
      * E2E (`test/e2e/`, 14 tests, gated on `SCHOOLSOFT_E2E=1`):
        - Bootstrap: `SCHOOLSOFT_SCHOOL=taby npm run e2e:login` — one
          human BankID login seeds the session; all suites then run
          unattended via `npm run test:e2e`.
        - 01-auth: silent restore, FORCED token refresh (expiry
          manipulated in the store — no waiting days), garbage-session
          fail-closed, all against the real backend.
        - 02-mcp-stdio: spawns the built `dist/index.js` as a subprocess
          over real stdio (exactly like Claude Desktop) and exercises
          every tool against real data, incl. response-size bounds.
          The only suite testing the shipped artifact. Build first.
        - 03-discovery: probes multi-child session shape, guardian API
          coverage, token-lifetime snapshots for longitudinal reruns.
        - Findings auto-accumulate in `e2e-report.md` (gitignored),
          answering the numbered open questions above; session dump in
          `e2e-session-dump.json` (gitignored — contains child data).
        - `npm run typecheck` typechecks src + tests + scripts.
- [ ] Optional: streamable HTTP transport for remote use

## Legal/GDPR notes

- Children's personal data: store nothing beyond the encrypted session;
  never log tool outputs; data goes only to the LLM call the user makes.
- Check SchoolSoft ToS re: automated access before any public release.
- Not affiliated with SchoolSoft AB — keep the disclaimer in README.

## Dev commands

- `npm run build` — tsc to dist/
- `npm run dev` — run from source (tsx)
- `npm run inspect` — MCP Inspector against source
- Smoke test: pipe initialize + tools/list JSON-RPC into `node dist/index.js`

Env: `SCHOOLSOFT_SCHOOL` (required, e.g. `taby`), `SCHOOLSOFT_USER_TYPE`
(parent|student|teacher, default parent), `SCHOOLSOFT_CLIENT_ID` (default
eApp), `SCHOOLSOFT_ORGID`, `SCHOOLSOFT_CALLBACK_PORT`, `SCHOOLSOFT_STATE_DIR`.

Gotcha: the rtk shell hook rewrites `npx tsx`; call `./node_modules/.bin/tsx`.
