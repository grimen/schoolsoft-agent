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

## Live findings (Täby, guardian account, 2026-09-06)

Answered:

1. **Localhost redirect_uri: ACCEPTED.** SchoolSoft delivered the code to
   `http://127.0.0.1:43117/callback` (green "Inloggad" page). No fallback
   strategy needed for the callback.
2. **Login route is per user type**, and it matters. SchoolSoft's login app
   routes everything under `#/login/<parent|student|teacher>/…`; ssp-node
   hardcodes `student`. Guardians on the student route get "Användaren …
   är inte aktiv på den här skolan" after a successful BankID. orgid is
   irrelevant for SAML/BankID (only the password flows send it). Täby's
   slug is `taby`; Rösjöskolan is orgId 20 in the public school list
   (`/internal/rest-api/login/schoollist`, 3414 schools).
   - Täby app login methods (`/rest-api/login/methods/?client_id=eApp&usertype=parent`):
     SAML (3) + app username/password (4). No direct BankID (11) — BankID
     comes via Täby's SAML IdP (`etjanst.taby.se/wa/auth/saml`).
   - ssp-node's token→cookie exchange also hardcodes
     `/eva-apps/auth/login/student`; replaced by `src/auth/session-exchange.ts`.

Still open (blocks everything):

- **SchoolSoft stamps `user_type` into the access token and resolves the
  user at use time.** With the parent route + client_id `eApp`, the JWT
  still came back `user_type: STUDENT` (`login_method: SAML`, `sub` is a
  UUID from `https://schoolsoft.se/core/login`), so refresh, `/rest-api/session`
  (Bearer) and the cookie exchange all fail with "Vi kunde inte hitta
  användaren". Hypotheses, in order:
  a. client_id decides the type: `eApp` = student app, `vApp` = guardian
     app (the login bundle special-cases both). Test: `SCHOOLSOFT_CLIENT_ID=vApp`.
     The token endpoint accepts any clientId string, so only a real login tells.
  b. Guardian needs "Åtkomst från app" enabled under Min profil on the web
     before app logins resolve.
  c. SchoolSoft's SAML return handler drops the route's user type.
  The strategy now logs the token's claims to stderr right after the code
  exchange, so one BankID round answers this. All OAuth pieces
  (`src/auth/oauth.ts`) are ours now; ssp-node is only used for its HTTP
  helpers and data endpoints.
3. **Multi-child accounts.** Unknown until a guardian token works.
4. **Token/session lifetimes.** Access token JWT exp was 15 min
   (`iat`→`exp`); token response had no `expires` field, so we fall back
   to the JWT exp. Refresh-token lifetime unknown.

## Roadmap

- [ ] Live-test auth flow end to end — Q1/Q2 done; user_type stamping open (see above)
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

Env: `SCHOOLSOFT_SCHOOL` (required, e.g. `taby`), `SCHOOLSOFT_USER_TYPE`
(parent|student|teacher, default parent), `SCHOOLSOFT_CLIENT_ID` (default
eApp), `SCHOOLSOFT_ORGID`, `SCHOOLSOFT_CALLBACK_PORT`, `SCHOOLSOFT_STATE_DIR`.

Gotcha: the rtk shell hook rewrites `npx tsx`; call `./node_modules/.bin/tsx`.
