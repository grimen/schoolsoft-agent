# Two-Surface Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the working guardian MCP server into `schoolsoft-agent`: one core, an operation registry, MCP + CLI/skill surfaces, per-host plugin packaging, docs with diagrams, full test pyramid, Makefile, GitHub repo with CI.

**Architecture:** `src/core` (auth, session, api, operations registry, config; no env, no adapters) → `src/mcp` and `src/cli` adapters derived from the registry → `skills/schoolsoft` wraps the CLI → `plugins/` hold per-host manifests pointing at the npm package. Generated docs with drift tests keep surfaces and docs in sync.

**Tech Stack:** TypeScript 7 / Node 24, `@modelcontextprotocol/sdk`, `zod` 4, `commander`, `c8`, `prettier`, `node:test` + `tsx`, Mermaid in Markdown, GitHub Actions, `gh`.

**Spec:** `docs/planning/specs/2026-09-06-two-surface-foundation-design.md`

## Global Constraints

- Node `>=22` in `engines`; CI uses Node 24. Package name `schoolsoft-agent`, bins `schoolsoft-agent` and `schoolsoft-agent-mcp`, license MIT.
- `src/core` imports nothing from `src/mcp`, `src/cli`, `src/http`, or `node:process`; adapters import core only via `src/core/index.ts`.
- Every operation: unique snake_case `name`, non-empty `description` with "Use when:", all of `readOnly/destructive/idempotent/requiresAuth`.
- Existing env names `SCHOOLSOFT_SCHOOL`, `SCHOOLSOFT_ORGID`, `SCHOOLSOFT_USER_TYPE`, `SCHOOLSOFT_CLIENT_ID`, `SCHOOLSOFT_CALLBACK_PORT`, `SCHOOLSOFT_STATE_DIR` keep working; new `SCHOOLSOFT_CONFIG_DIR`.
- CLI exit codes: 0 ok, 1 error, 2 not authenticated, 3 not configured.
- MCP tool names stay `schoolsoft_<operation>` so existing E2E and hosts keep working.
- No child data in git: `e2e-report.md`, `e2e-session-dump.json`, state dirs stay ignored.
- Commits: conventional prefixes; no Claude-Session trailer.
- The rtk shell hook rewrites `npx tsx`; always invoke `./node_modules/.bin/tsx`.
- Coverage: core 100 % lines+branches, mcp/cli 90 %. E2E never in CI.

---

### Task 1: Repo identity, GitHub remote, worktree, Makefile skeleton

**Files:**
- Modify: `package.json` (name, bins, engines, scripts, files), `README.md` (title only), `.gitignore`
- Create: `Makefile`, `.prettierrc`, `.nvmrc`
- Test: none (tooling), verified by `make check` running

**Interfaces:**
- Produces: `make help|setup|build|typecheck|test|check|docs|skills|plugin-validate|e2e|login|status|logout|configure|doctor|release`. Targets not yet implementable call a stub that exits 1 with "not implemented in this task" until later tasks fill them.

- [ ] Step 1: Rename package: `name: "schoolsoft-agent"`, `bin: { "schoolsoft-agent": "dist/cli/index.js", "schoolsoft-agent-mcp": "dist/mcp/index.js" }`, `engines: { node: ">=22" }`, `files: ["dist", "skills", "README.md", "LICENSE"]`, `repository`, `homepage`. Add devDeps `commander`, `c8`, `prettier`. Add `LICENSE` (MIT, Jonas Grimfelt 2026).
- [ ] Step 2: Makefile with `help` (self-documenting `##` comments), `setup` (node version check `node -e "process.exit(+process.versions.node.split('.')[0]>=22?0:1)"` then `npm ci`), `build`, `typecheck`, `fmt`, `fmt-check`, `test`, `check` (= typecheck fmt-check boundaries test coverage), `e2e`, CLI passthroughs, `release` (guarded by check; `npm version $(V)`, `npm publish --provenance --access public`, `git push --follow-tags`).
- [ ] Step 3: `gh repo create grimen/schoolsoft-agent --public --source . --push` (history as-is), then `git worktree add ../schoolsoft-agent-foundation -b feat/two-surface-foundation`. All following tasks run in the worktree.
- [ ] Step 4: `make setup && make typecheck && make test` green in the worktree. Commit `chore: rename to schoolsoft-agent, add Makefile`.

### Task 2: Core restructure and boundary enforcement

**Files:**
- Move: `src/auth/*` → `src/core/auth/`, `src/api/*` → `src/core/api/`, `src/services/{session-manager,store,file-store}.ts` → `src/core/session/`, `src/constants.ts` → `src/core/constants.ts`, `src/services/respond.ts` → `src/mcp/respond.ts`
- Create: `src/core/config.ts`, `src/core/index.ts`, `scripts/check-boundaries.ts`, `test/boundary/imports.test.ts`
- Delete: `src/services/wiring.ts` (split: pure parts → `config.ts`; bootstrap → adapters in Task 5/6)
- Test: `test/unit/*` (moved existing tests, paths updated), `test/boundary/imports.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // src/core/config.ts
  export interface Config { school: string; orgId?: string; userType: SchoolsoftUserType; clientId: string; callbackPort: number; stateDir: string; configDir: string }
  export interface ConfigSource { school?: string; orgId?: string; userType?: string; clientId?: string; callbackPort?: number|string; stateDir?: string; configDir?: string }
  export class NotConfiguredError extends Error {}
  export function resolveConfig(sources: ConfigSource[], defaults: { home: string; platform: NodeJS.Platform }): Config   // earlier sources win; throws NotConfiguredError if school missing
  export function defaultConfigDir(home: string, platform: NodeJS.Platform): string
  export function envSource(env: Record<string,string|undefined>): ConfigSource   // pure mapping of SCHOOLSOFT_* keys
  export function createSessionManager(config: Config, deps?: { store?: SessionStore; fetchImpl?; openBrowser? }): SessionManager
  export function createGuardianApi(manager: SessionManager): GuardianApi
  // src/core/index.ts re-exports: config, SessionManager, NotAuthenticatedError, GuardianApi types, childOf, orgIdOf, operations registry (Task 3), findSchools (Task 4)
  ```
- [ ] Step 1: Write `test/boundary/imports.test.ts`: walks `src/**/*.ts`, parses `import ... from "..."` lines, asserts core files import no `../mcp|../cli|../http|node:process`, and `src/mcp|src/cli` files import core only as `../core/index.js`. Run: fails (files not moved yet / wiring imports process).
- [ ] Step 2: `git mv` files; fix relative imports; create `config.ts` with the functions above and unit tests (`test/unit/config.test.ts`: precedence, env mapping, NotConfiguredError, platform dirs). Create `index.ts`.
- [ ] Step 3: Move tests to `test/unit/`, update paths, `package.json` `test` script = `tsx --test 'test/unit/**/*.test.ts' 'test/boundary/**/*.test.ts' 'test/functional/**/*.test.ts' 'test/packaging/**/*.test.ts'`.
- [ ] Step 4: `scripts/check-boundaries.ts` same logic as the test, exit 1 on violation; `make boundaries`. Run `make check` green. Commit `refactor: core/adapter layering with enforced boundaries`.

### Task 3: Operation registry and migration of the 11 tools

**Files:**
- Create: `src/core/operations/types.ts`, `registry.ts`, `list-children.ts`, `get-schedule.ts`, `get-lunch-menu.ts`, `get-assignments.ts`, `get-assignment-detail.ts`, `get-news.ts`, `get-messages.ts`, `get-message.ts`, `login.ts`, `auth-status.ts`, `logout.ts`, `_shared.ts` (isoWeek, WeekSchema, ChildSchema, `withChild(ctx, childId)`)
- Test: `test/unit/operations.test.ts` (each op with fake api/manager), `test/boundary/registry.test.ts`
- Delete: `src/tools/read.ts`, `src/tools/auth.ts` (Task 5 replaces)

**Interfaces:**
```ts
export interface OperationAnnotations { readOnly: boolean; destructive: boolean; idempotent: boolean; requiresAuth: boolean }
export interface OperationContext { manager: SessionManager; api: GuardianApi; config: Config; log: (msg: string) => void }
export interface Operation<I extends z.ZodRawShape = z.ZodRawShape, O = unknown> { name: string; title: string; description: string; input: I; annotations: OperationAnnotations; run(ctx: OperationContext, args: z.infer<z.ZodObject<I>>): Promise<O> }
export function defineOperation<I extends z.ZodRawShape, O>(op: Operation<I,O>): Operation<I,O>
export const operations: readonly Operation[]   // ordered: find_school (Task 4), list_children, get_schedule, get_lunch_menu, get_assignments, get_assignment_detail, get_news, get_messages, get_message, login, auth_status, logout
export function getOperation(name: string): Operation | undefined
```
- [ ] Step 1: `test/boundary/registry.test.ts`: names unique snake_case; descriptions contain "Use when:"; annotations complete; `requiresAuth:false` only for `find_school`, `auth_status`; every op's `input` keys are camelCase or snake_case consistently (snake_case, matching today's `child_id`).
- [ ] Step 2: `test/unit/operations.test.ts`: port the assertions from `test/functional.test.ts` (child switch, unknown child error, unread filter, message fetch, schedule default child) to direct `op.run(ctx, args)` calls with `fakeApi`/`FakeAuth` moved to `test/helpers/fakes.ts`.
- [ ] Step 3: Implement `types.ts`, `_shared.ts`, each operation (bodies = today's tool handlers returning plain objects, not `ToolResult`), `registry.ts`. `login` op input `{ strategy?: string }` returns `{ status, user }`; `auth_status` returns today's object (needs `config.school`); `logout` returns `{ status: "logged_out" }`.
- [ ] Step 4: Run unit + boundary green. Commit `feat(core): operation registry`.

### Task 4: `find_school`

**Files:**
- Create: `src/core/api/schools.ts`, `src/core/operations/find-school.ts`
- Test: `test/unit/schools.test.ts`

**Interfaces:**
```ts
export interface SchoolEntry { name: string; slug: string; orgId: number }
export function parseSchoolList(raw: unknown): SchoolEntry[]           // from {name, orgId, evaUrl} → slug from evaUrl path segment
export function normalize(s: string): string                            // lowercase, strip diacritics (NFD + /\p{M}/gu), collapse spaces
export function rankSchools(entries: SchoolEntry[], query: string, limit = 10): (SchoolEntry & { score: number })[]  // exact normalized name 100, startsWith 80, all query tokens contained 60, any token 30; stable by name
export class SchoolDirectory { constructor(o: { cacheFile: string; ttlMs?: number; fetchImpl?: (url: string) => Promise<unknown>; now?: () => number }); list(): Promise<SchoolEntry[]>; find(query: string, limit?: number): Promise<ranked[]> }
```
- [ ] Step 1: Tests: parse fixture of 5 entries (incl. Täby kommun orgId 20 → slug `taby`); normalize("Rösjöskolan") → "rosjoskolan"; rank finds "Täby kommun - Rösjöskolan" for "rösjö"; cache written and reused within TTL, refetched after TTL; fetch failure with valid cache falls back to cache.
- [ ] Step 2: Implement; operation `find_school` `{ query: z.string().min(2), limit?: z.number().int().min(1).max(50) }` → `{ schools: [...] }`, `requiresAuth:false`, uses `SchoolDirectory` with cache at `config.configDir/schools.json`. Register first in registry. Commit `feat: find_school over the public school list`.

### Task 5: MCP adapter from the registry

**Files:**
- Create: `src/mcp/server.ts` (`createMcpServer(ctxFactory): McpServer`), `src/mcp/index.ts` (stdio entry: env → config → ctx → server), keep `src/mcp/respond.ts`
- Test: `test/functional/mcp.test.ts` (rewrite of today's functional test against `createMcpServer` with fake ctx)
- Delete: old `src/index.ts`, `src/tools/`

- [ ] Step 1: Functional test: `tools/list` returns 12 `schoolsoft_*` names with `readOnlyHint` mirrored from annotations; validation (week 99) error; not-authenticated error mentions `schoolsoft_login`; login → schedule structured content; child switch; logout invalidates.
- [ ] Step 2: Implement: for each op `server.registerTool("schoolsoft_"+name, { title, description, inputSchema: op.input, annotations: { readOnlyHint: a.readOnly, destructiveHint: a.destructive, idempotentHint: a.idempotent, openWorldHint: true } }, guarded(args => op.run(ctx, args).then(ok)))`. `index.ts` builds `Config` via `resolveConfig([envSource(process.env)], { home, platform })`; on `NotConfiguredError` still starts and every tool returns an error naming `configure`.
- [ ] Step 3: Build + stdio smoke (initialize + tools/list) shows 12 tools. Commit `feat(mcp): registry-driven server`.

### Task 6: CLI adapter

**Files:**
- Create: `src/cli/flags.ts` (`flagsFromSchema(shape): FlagSpec[]`, `parseFlags(shape, opts): args`), `src/cli/program.ts` (`buildProgram(deps): Command`), `src/cli/exit-codes.ts`, `src/cli/commands/configure.ts`, `doctor.ts`, `src/cli/index.ts` (bin)
- Test: `test/unit/flags.test.ts`, `test/functional/cli.test.ts`, `test/functional/cli-spawn.test.ts`

**Interfaces:**
```ts
export const EXIT = { OK: 0, ERROR: 1, NOT_AUTHENTICATED: 2, NOT_CONFIGURED: 3 } as const
export interface CliDeps { ctxFactory: () => Promise<OperationContext>; stdout: (s: string) => void; stderr: (s: string) => void; env: Record<string,string|undefined>; prompt?: (q: string) => Promise<string> }
export function buildProgram(deps: CliDeps): Command      // commander, exitOverride so tests can assert codes
export async function runCli(argv: string[], deps: CliDeps): Promise<number>
```
- [ ] Step 1: `flags.test.ts`: number → `--week <number>` parsed to number; boolean → `--unread-only` presence; optional/required; enum validated; `.describe()` → help text; unsupported type (e.g. ZodArray) throws at build time.
- [ ] Step 2: `cli.test.ts` with fake ctx: `get-schedule --week 35 --child-id 101` prints JSON with child 101; `get-messages --unread-only`; not-authenticated → code 2 and stderr mentions `login`; missing config → code 3 mentions `configure`; unknown child → code 1; `--pretty` indents; `--version`.
- [ ] Step 3: Implement `flags.ts`, `program.ts` (one command per op, kebab-case; `configure` interactive via `deps.prompt` using `find_school`, writes config file; `doctor` prints checks: node version, config file, session state present, `sms.schoolsoft.se` reachable via HEAD, opener binary present; `--fix` migrates `~/.schoolsoft-mcp` → stateDir).
- [ ] Step 4: `cli-spawn.test.ts`: build, spawn `dist/cli/index.js --help` and `find-school --query rösjö` with `SCHOOLSOFT_CONFIG_DIR` pointing at a temp dir seeded with a schools cache fixture → exit 0, JSON. Commit `feat(cli): registry-driven commands, exit codes, configure, doctor`.

### Task 7: Skill surface and generated references

**Files:**
- Create: `skills/schoolsoft/SKILL.md`, `skills/schoolsoft/scripts/schoolsoft.sh`, `skills/schoolsoft/references/commands.md` (generated), `scripts/gen-docs.ts` (also writes `docs/reference/commands.md`, `docs/reference/tools.md`)
- Test: `test/boundary/generated-docs.test.ts` (generator output === committed), `test/packaging/skill.test.ts` (frontmatter per agentskills.io: name regex + equals dir, description ≤1024, body <500 lines)

- [ ] Step 1: Tests first (fail: files missing).
- [ ] Step 2: `gen-docs.ts`: from registry render tables: operation, MCP tool name, CLI command, flags (from `flagsFromSchema`), annotations, example. Write three files. `make docs` runs it.
- [ ] Step 3: `SKILL.md` per spec §4.3; `schoolsoft.sh` resolution order `$SCHOOLSOFT_AGENT_BIN` → `$SKILL_DIR/../../dist/cli/index.js` → `command -v schoolsoft-agent` → `npx -y schoolsoft-agent`. Commit `feat(skill): schoolsoft skill with generated command reference`.

### Task 8: Host plugin packaging

**Files:**
- Create: `plugins/claude/.claude-plugin/marketplace.json`, `plugins/claude/schoolsoft-mcp/.claude-plugin/plugin.json`, `plugins/claude/schoolsoft-mcp/.mcp.json`, `plugins/claude/schoolsoft-skill/.claude-plugin/plugin.json`, `plugins/mcpb/manifest.json`, `plugins/opencode/opencode.json`, `plugins/{opencode,openclaw,hermes}/skill-metadata.json`, `plugins/pi/pi.json`, `scripts/gen-skills.ts`, `scripts/validate-plugins.ts`
- Test: `test/packaging/manifests.test.ts`

- [ ] Step 1: Test: each JSON parses; marketplace has exactly `schoolsoft-mcp` and `schoolsoft-skill` with relative sources; `.mcp.json` command is `npx` with args `["-y","-p","schoolsoft-agent","schoolsoft-agent-mcp"]` and env passthrough `SCHOOLSOFT_SCHOOL: "${SCHOOLSOFT_SCHOOL}"`; mcpb manifest has `manifest_version`, `server.mcp_config`, `user_config.school`, and every tool listed with annotations matching the registry; `gen-skills` output for each host has merged `metadata.<host>` and unchanged body.
- [ ] Step 2: Write manifests (values per host research in spec §6). `gen-skills.ts` → `dist/skills/<host>/schoolsoft/` and copies into `plugins/claude/schoolsoft-skill/skills/` (committed). `validate-plugins.ts`: runs `claude plugin validate` and `npx skills-ref validate` when available, else JSON-schema-lite checks; `make plugin-validate`. Commit `feat(plugins): marketplace and per-host manifests`.

### Task 9: Makefile completion, install targets, coverage

**Files:**
- Modify: `Makefile`, `package.json` (`c8` config: thresholds per directory via `.c8rc.json`), `.gitignore`
- Test: `make check` itself

- [ ] Step 1: `install-claude` (`claude plugin marketplace add ./plugins/claude` + install both), `install-opencode` (copy skill to `.agents/skills/`, print `opencode.json` snippet), `install-hermes` (copy to `~/.hermes/skills/education/schoolsoft`), `install-openclaw` (copy to `~/.openclaw/skills/schoolsoft`), `install-pi` (copy to `~/.pi/agent/skills/schoolsoft`), `mcpb` (`npx @anthropic-ai/mcpb pack` into `dist/`), `skills`, `docs`, `coverage` (c8 with thresholds).
- [ ] Step 2: `make check` green with coverage thresholds. Commit `build: complete Makefile, coverage thresholds`.

### Task 10: Documentation with diagrams

**Files:**
- Create: `docs/development/architecture.md` (5 Mermaid diagrams per spec §7), `docs/reference/schoolsoft-api.md`, `docs/integrations/{claude-code,claude-desktop,opencode,openclaw,hermes,pi}.md`, `docs/reference/` (generated), `CHANGELOG.md`
- Modify: `README.md`, `CLAUDE.md` (trim to rules + pointers)
- Test: `test/boundary/docs-links.test.ts` (every relative link in docs resolves; every Mermaid block parses via a fence sanity check)

- [ ] Step 1: Link test first. Step 2: write docs. Step 3: commit `docs: architecture, API catalogue, host guides`.

### Task 11: E2E extensions and live run

**Files:**
- Modify: `test/e2e/02-mcp-stdio.e2e.test.ts` (tool count 12, find_school), create `test/e2e/04-cli.e2e.test.ts` (spawns `dist/cli/index.js`: `status`, `list-children`, `get-schedule`, `get-messages --limit 3`, `find-school --query rösjö`; exit codes), `test/e2e/helpers.ts` (config dir env)

- [ ] Step 1: Write tests. Step 2: `make build && make e2e` locally with `SCHOOLSOFT_SCHOOL=taby`: all green. Commit `test(e2e): CLI surface and find_school`.

### Task 12: CI, PR, release dry run

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `.github/PULL_REQUEST_TEMPLATE.md`

- [ ] Step 1: `ci.yml`: push+PR, Node 24, `make setup check plugin-validate build skills mcpb`, upload `dist/*.mcpb` artifact. `release.yml`: on `v*` tag, `make check`, `npm publish --provenance` (needs `NPM_TOKEN` secret; documented), GitHub release with mcpb.
- [ ] Step 2: `npm pack --dry-run` shows dist + skills only. Push branch, open PR with summary + diagram link. Commit `ci: workflows`.

## Self-review

- Spec coverage: §3 (T2,T3), §3.4 (T4), §3.5 (T2,T6), §4.1 (T5), §4.2 (T6), §4.3 (T7), §5 (T1,T9), §6 (T8), §7 (T10), §8 (T2–T11), §9 (T1,T12), §10 (T2–T5). Remote transport intentionally absent (spec 3).
- Names used consistently: `resolveConfig`, `envSource`, `createSessionManager`, `createGuardianApi`, `operations`, `getOperation`, `defineOperation`, `flagsFromSchema`, `buildProgram`, `runCli`, `EXIT`, `SchoolDirectory`, `rankSchools`.
