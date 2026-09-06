# schoolsoft-mcp-server — project context

Unofficial MCP server (TypeScript, stdio) for SchoolSoft, targeting parents
("vårdnadshavare") in municipalities like Täby where login is BankID.
Goal: seamless read/write access from Claude/ChatGPT/other MCP clients.

## Architecture decisions (already made)

- **API layer: `@elias4044/ssp-node`** (MIT, npm). Typed client for
  SchoolSoft's unofficial mobile API. Verified against its `.d.ts` files —
  the README matches the real surface. Alternatives evaluated and rejected:
  - `kanylbullen/schoolsoft-mcp` (Python MCP, HTML scraping, password-only
    auth, most tools "experimental") — used as functional spec only.
  - `CarelessInternet/node-schoolsoft` — untested for guardian accounts.
  - `jojomondag/ApiForge` (no license) — its session-persistence pattern
    inspired ours; its HAR-record+LLM-analyze method is the plan for
    mapping unknown write endpoints.
- **Auth: interactive-first.** BankID must never be automated. The
  `schoolsoft_login` tool opens the real SchoolSoft login page in the
  user's browser (OAuth2+PKCE via `SchoolsoftClient.startMobileFlow` with
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

## ⚠️ Verify live first (cannot be tested without real SchoolSoft access)

1. **Does SchoolSoft's OAuth server accept a localhost redirect_uri?**
   Default is the app deep-link `com.schoolsoftplus.app://` (hardcoded in
   ssp-node's `auth/mobile.js`; auth URL goes to
   `https://sms.schoolsoft.se/<school>/react/#/login/student`). If
   localhost is rejected: fallbacks A–C are documented at the bottom of
   `src/auth/browser-flow.ts` (Playwright interception, cookie capture,
   or one-time BankID bootstrap → username/password via "Min profil" +
   "Åtkomst från app").
2. **Guardian vs student login route.** The auth URL path says
   `/login/student` — check whether guardians need a different path/orgid
   for the BankID option to appear, and whether Täby's slug is `taby`.
3. **Multi-child accounts.** Guardians switch between children after
   login; ssp-node's endpoints may need a child/org selector. Inspect
   `getSession()` output for available orgs/students.
4. **Token/session lifetimes.** How long does the refresh token live?
   Decide whether a keep-alive is needed.

## Roadmap

- [ ] Live-test auth flow end to end (items above) against real account
- [ ] Add `schoolsoft_get_messages` (inbox) — check if ssp-node covers it,
      else map endpoint via HAR recording
- [ ] **Write ops (the differentiator, nothing open source has these):**
      `schoolsoft_report_absence`, `schoolsoft_send_message`,
      `schoolsoft_apply_leave`, respond to bookings. Map via HAR
      (log in via browser devtools → record the action → replay with
      session cookies). Mark all with destructiveHint and require
      explicit user confirmation in tool descriptions.
- [ ] Multi-child support (child selector param on relevant tools)
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

Env: `SCHOOLSOFT_SCHOOL` (required, e.g. `taby`), `SCHOOLSOFT_ORGID`,
`SCHOOLSOFT_CALLBACK_PORT`, `SCHOOLSOFT_STATE_DIR`.
