# App Workspace (E11.4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the repository into npm workspaces with one Expo app at `packages/app` that lists the children a grant covers, from a running connector, without the published package, connector image, root checks or root audit changing.

**Architecture:**

- The root stays the published `schoolsoft-agent` package.
- `packages/app` is a private Expo Router project that imports only `schoolsoft-agent/client`.
- In development, a small Node proxy makes the app and the connector one origin (it rewrites `Origin` for connector-bound requests). A development-only screen takes a client ID and refresh token from the reference page.
- Fences keep Expo out of every root install path, each enforced by a script, a Dockerfile step or a test.

**Tech Stack:**

- Expo (the latest SDK at execution time) with Expo Router and react-native-web, and strict TypeScript.
- `jest-expo` and `@testing-library/react-native` for the app; `node:test` for the proxy; Playwright/Chromium (already a root dev dependency) for the E2E test.
- oxlint and prettier (the repository's).

**Spec:** `docs/planning/specs/2026-09-26-app-workspace.md` (PR #71). Read it before starting; this plan argues from it.

**Branch:** implement on `feat/app-workspace`, created from `origin/main` in a new worktree. This plan and the spec live on `docs/app-workspace-spec`.

## Global Constraints

- The root `package.json` keeps its `name`, `bin`, `files`, `exports`, `scripts` and build (`tsc`) unchanged; only `"workspaces": ["packages/app"]` is added.
- `packages/app/package.json` has `"private": true`.
- The app imports nothing from the root package except `schoolsoft-agent/client`.
- No change to `src/` (the published code), any REST route, or the typed client's public API. If a task needs one, stop and report it.
- Root CI jobs, the connector image and `make check` install the root package only; no `expo`, `react-native` or `react` directory may exist in their `node_modules`.
- The root coverage gate (100%) and root boundary tests stay as they are and keep passing.
- The app's coverage gate: 100% lines, branches, functions and statements on `src/connection/**`, `src/messages.ts` and `src/use-children.ts`. Screens get component tests with no threshold.
- The development connection's storage key is `schoolsoft-app-dev`; the reference page's key (read-only for us) is `schoolsoft-reference`, with shape `{ client?: { id: string }, refresh?: string }`.
- Development code (the connect screen) is absent from a production web export.
- Conventional Commits; commitlint and lefthook must pass. No AI attribution in commits or PRs.
- `schoolsoft-agent/client` resolves to `dist/client/`, so every app target runs the root `npm run build` first.

## Spec Clarifications (found while planning; confirm with the owner before Task 1)

1. **Origin rewrite.** The REST surface refuses a request whose `Origin` is not the connector's `publicUrl` (`src/http/rest.ts:90`). The dev proxy therefore sets `Origin` to the connector's origin on connector-bound requests, and `CONNECTOR_URL` must equal the connector's `SCHOOLSOFT_PUBLIC_URL`. Nothing else is rewritten except the upstream address and `Host`.
2. **The `/dev-connect` route in production.** Expo Router routes are files, so the route file ships in every build. In production it only redirects to `/`, and the development component is `require`d behind `__DEV__`, so the minifier removes it. The production check asserts the development code (marker strings) is absent and that `/dev-connect` redirects.
3. **Children show a first name only.** `GET /api/v1/children` returns `{ id, firstName }` per child; the spec's "school and class, as far as the connector provides them" means first names today.
4. **E2E build.** `make app-e2e` serves a development-mode static export (`expo export --platform web --dev`) through the same proxy, instead of the live dev server, for speed and determinism. `make app-web` uses the live dev server. If `--dev` export is unavailable in the pinned SDK, the E2E test starts the dev server instead with a 180-second ready timeout.

## Review Focus

- **`CONNECTOR_URL` doesn't match the connector's public URL** (e.g. `127.0.0.1` vs `localhost`): every request is refused as `foreign-origin`. Expect a clear error at start-up, not a broken app. Pinned in Task 7: `checkConnector` compares `CONNECTOR_URL` with the authorization server's `issuer`, with a test for each side.
- **Pasting the reference page's refresh token while that tab is still open:** a later refresh in that tab revokes the grant. Expect the warning on the connect screen, and "connect again" when it happens. Pinned in Tasks 4 and 6.
- **Session storage throws** (private mode, blocked storage): expect the app to work for the page's lifetime with a notice, not crash. Pinned in Task 4.
- **A stale answer after "forget this connection" or a reconnect:** it must never show the previous grant's children. Pinned in Task 5.
- **Root-only install silently pulling Expo** after a dependency change: expect CI to fail loudly. Pinned in Task 2 by `scripts/ci/assert-root-install.sh` and the Dockerfile guard.

---

### Task 1: Workspace and Expo scaffold

**Files:**
- Modify: `package.json` (add `workspaces`)
- Create: `packages/app/package.json`, `packages/app/app.json`, `packages/app/tsconfig.json`, `packages/app/babel.config.js`, `packages/app/jest.config.js`, `packages/app/.oxlintrc.json`, `packages/app/app/_layout.tsx`, `packages/app/app/index.tsx`
- Modify: `.prettierignore`, `.gitignore`
- Test: `packages/app/app/__tests__/smoke.test.tsx`

**Interfaces:**
- Produces: the npm workspace `packages/app`, named `@schoolsoft-agent/app`; npm scripts `test`, `test:coverage`, `lint`, `typecheck`, `web`, `export:web`; `jest.config.js` with the split coverage gate.

- [ ] **Step 1: Create the worktree and branch**

```bash
git -C /Users/jonas/Dev/schoolsoft-agent-mainwt fetch origin
git -C /Users/jonas/Dev/schoolsoft-agent-mainwt worktree add /Users/jonas/Dev/schoolsoft-agent-app -b feat/app-workspace origin/main
cd /Users/jonas/Dev/schoolsoft-agent-app
```

- [ ] **Step 2: Generate the Expo project without installing**

```bash
npx create-expo-app@latest packages/app --template blank-typescript --no-install
```

Record the SDK version the template pins (`packages/app/package.json` → `dependencies.expo`) in the PR description. Delete the template's `App.tsx` and `index.ts`; Expo Router replaces them.

- [ ] **Step 3: Add the workspace to the root `package.json`**

Add this top-level key, changing nothing else:

```json
"workspaces": ["packages/app"]
```

- [ ] **Step 4: Write `packages/app/package.json`**

Keep the template's `expo`, `react`, `react-native` versions and replace the rest with:

```json
{
  "name": "@schoolsoft-agent/app",
  "private": true,
  "version": "0.0.0",
  "main": "expo-router/entry",
  "scripts": {
    "web": "node scripts/dev-web.mjs",
    "export:web": "expo export --platform web --output-dir dist-web",
    "test": "jest",
    "test:coverage": "jest --coverage",
    "lint": "oxlint --max-warnings=0 app src scripts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "schoolsoft-agent": "*"
  }
}
```

Then install the Expo-managed dependencies at versions matching the SDK:

```bash
cd packages/app
npx expo install expo-router react-native-web react-dom @expo/metro-runtime react-native-safe-area-context react-native-screens expo-linking expo-constants expo-status-bar expo-localization
npx expo install -- --save-dev jest-expo jest @testing-library/react-native @types/jest @types/react typescript
cd ../..
npm install
```

- [ ] **Step 5: Write the config files**

`packages/app/app.json`:

```json
{
  "expo": {
    "name": "SchoolSoft",
    "slug": "schoolsoft-agent-app",
    "scheme": "schoolsoft-agent",
    "version": "0.0.0",
    "platforms": ["web", "ios", "android"],
    "web": { "bundler": "metro", "output": "single" },
    "plugins": ["expo-router", "expo-localization"],
    "experiments": { "typedRoutes": false }
  }
}
```

`packages/app/tsconfig.json`:

```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": { "strict": true, "noUncheckedIndexedAccess": true },
  "include": ["app", "src", "**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules", "dist-web", "scripts", "e2e"]
}
```

`packages/app/babel.config.js`:

```js
module.exports = function (api) {
  api.cache(true);
  return { presets: ["babel-preset-expo"] };
};
```

`packages/app/jest.config.js`:

```js
/** Split quality bar (spec: Testing and CI): plumbing at 100%, screens tested without a threshold. */
module.exports = {
  preset: "jest-expo/web",
  testPathIgnorePatterns: ["/node_modules/", "/e2e/", "/scripts/"],
  collectCoverageFrom: ["src/connection/**/*.{ts,tsx}", "src/messages.ts", "src/use-children.ts"],
  coverageThreshold: { global: { lines: 100, branches: 100, functions: 100, statements: 100 } },
};
```

`packages/app/.oxlintrc.json`:

```json
{
  "$schema": "../../node_modules/oxlint/configuration_schema.json",
  "plugins": ["typescript", "react", "unicorn", "oxc"],
  "categories": { "correctness": "error", "suspicious": "warn", "perf": "warn" },
  "rules": {
    "no-unused-vars": ["error", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_", "caughtErrors": "none" }],
    "typescript/no-explicit-any": "error",
    "no-console": "off"
  },
  "overrides": [{ "files": ["**/__tests__/**", "**/*.test.*"], "rules": { "typescript/no-explicit-any": "off" } }]
}
```

Append to `.prettierignore` and `.gitignore`:

```
packages/app/.expo/
packages/app/dist-web/
packages/app/coverage/
```

- [ ] **Step 6: Write the failing smoke test**

`packages/app/app/__tests__/smoke.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react-native";
import Index from "../index";

test("the app renders its first screen", () => {
  render(<Index />);
  expect(screen.getByText("SchoolSoft")).toBeTruthy();
});
```

- [ ] **Step 7: Run it and verify it fails**

Run: `npm run build && npm test --workspace packages/app -- app/__tests__/smoke.test.tsx`
Expected: FAIL, "Cannot find module '../index'".

- [ ] **Step 8: Write the minimal layout and index**

`packages/app/app/_layout.tsx`:

```tsx
import { Stack } from "expo-router";

export default function Layout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

`packages/app/app/index.tsx` (replaced in Task 6):

```tsx
import { Text, View } from "react-native";

export default function Index() {
  return (
    <View>
      <Text accessibilityRole="header">SchoolSoft</Text>
    </View>
  );
}
```

- [ ] **Step 9: Run it and verify it passes, with lint and typecheck**

Run: `npm test --workspace packages/app -- app/__tests__/smoke.test.tsx && npm run lint --workspace packages/app && npm run typecheck --workspace packages/app`
Expected: PASS, and both commands exit 0.

- [ ] **Step 10: Confirm the root is unchanged**

Run: `make check`
Expected: exit 0 (root gate, lint, format, boundaries all as before).

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json .prettierignore .gitignore packages/app
git commit -m "build(app): add the packages/app Expo workspace"
```

---

### Task 2: Fences, root-only installs proven

**Files:**
- Create: `scripts/ci/assert-root-install.sh`, `scripts/ci/changed-app.sh`
- Modify: `.github/workflows/checks.yml`, `.github/workflows/test.yml`, `.github/workflows/e2e.yml`, `.github/workflows/ci.yml` (every `npm ci --ignore-scripts` in a root job), `Dockerfile.connector`, `scripts/pack-smoke.sh`, `.github/dependabot.yml`, `Makefile`
- Test: the scripts themselves, run locally in Step 3 and Step 6

**Interfaces:**
- Produces: the `ROOT_ONLY_INSTALL` command, `npm ci --ignore-scripts --workspaces=false`, used by every root job and the Dockerfile; `scripts/ci/assert-root-install.sh` (exit 1 if any app-only package is installed).

- [ ] **Step 1: Write the assertion script**

`scripts/ci/assert-root-install.sh`:

```bash
#!/usr/bin/env bash
# Fails when a root-only install pulled in the app's dependencies (spec: Workspace and fences).
set -euo pipefail
LEAKED=""
for pkg in expo react-native react react-dom expo-router jest-expo; do
  if [ -d "node_modules/$pkg" ]; then LEAKED="$LEAKED $pkg"; fi
done
if [ -n "$LEAKED" ]; then
  echo "root-only install leaked app dependencies:$LEAKED" >&2
  exit 1
fi
echo "root-only install: no app dependencies"
```

- [ ] **Step 2: Run it against a full install and verify it fails**

Run: `rm -rf node_modules && npm ci --ignore-scripts && bash scripts/ci/assert-root-install.sh`
Expected: exit 1, "root-only install leaked app dependencies: expo react-native react …"

- [ ] **Step 3: Verify the root-only install**

Run: `rm -rf node_modules && npm ci --ignore-scripts --workspaces=false && bash scripts/ci/assert-root-install.sh && make check`
Expected: "root-only install: no app dependencies", then `make check` exit 0.

**Decision gate:** if `npm ci --workspaces=false` either installs Expo packages or fails (for example, lockfile errors), try `npm ci --ignore-scripts --workspace=schoolsoft-agent --include-workspace-root=false` (and `--omit` variants). If no npm invocation installs the root dependencies alone from the shared lockfile, STOP and report back to the owner. The spec's fallback is a separate app lockfile, which is their decision.

- [ ] **Step 4: Use the root-only install in every root job**

In `.github/workflows/checks.yml`, `test.yml`, `e2e.yml` and `ci.yml`, replace each root-job `npm ci --ignore-scripts` with:

```yaml
      - name: Install dependencies (root package only; the app has its own job)
        run: npm ci --ignore-scripts --workspaces=false && bash scripts/ci/assert-root-install.sh
```

- [ ] **Step 5: Guard the connector image**

In `Dockerfile.connector`, replace `RUN npm ci --ignore-scripts` with:

```dockerfile
RUN npm ci --ignore-scripts --workspaces=false && test ! -d node_modules/expo && test ! -d node_modules/react-native
```

`.dockerignore` already allows only `package.json`, `package-lock.json`, `tsconfig.json` and `src/`, so `packages/` never enters the build context.

- [ ] **Step 6: Verify the image builds (if Docker is available)**

Run: `make connector-smoke`
Expected: the image builds and the smokes pass. Without Docker it prints its skip notice, and CI's `E2E / Connector image` job proves it.

- [ ] **Step 7: Guard the tarball**

In `scripts/pack-smoke.sh`, after the host-probe check, add:

```bash
if tar -tzf "$SMOKE"/schoolsoft-agent-*.tgz | grep -q '^package/packages/'; then
  echo "the app workspace must not be in the package" >&2
  exit 1
fi
```

Run: `make check-package`
Expected: "PACK SMOKE PASSED".

- [ ] **Step 8: Classify app changes**

`scripts/ci/changed-app.sh`:

```bash
#!/usr/bin/env bash
# app-changed=true when the app, the typed client or the dependency set changed (always on pushes).
set -euo pipefail
OUT="${GITHUB_OUTPUT:-/dev/stdout}"
if [ "${EVENT_NAME:-}" != pull_request ]; then
  echo "app-changed=true" >> "$OUT"; exit 0
fi
FILES=$(git diff --name-only "${BASE_SHA:?}"...HEAD)
if printf '%s\n' "$FILES" | grep -Eq '^packages/app/|^src/client/|^package(-lock)?\.json$|^scripts/ci/changed-app\.sh$|^\.github/workflows/app\.yml$'; then
  echo "app-changed=true" | tee -a "$OUT"
else
  echo "app-changed=false" | tee -a "$OUT"
fi
```

In `.github/workflows/checks.yml`, add an output and a step to the `changes` job:

```yaml
    outputs:
      docs-only: ${{ steps.classify.outputs.docs-only }}
      app-changed: ${{ steps.app.outputs.app-changed }}
```

```yaml
      - name: Did the app change?
        id: app
        env:
          EVENT_NAME: ${{ github.event_name }}
          BASE_SHA: ${{ github.event.pull_request.base.sha }}
        run: bash scripts/ci/changed-app.sh
```

And at the top of the workflow's `workflow_call.outputs`:

```yaml
      app-changed:
        description: "'true' when the app, the typed client or the dependencies changed"
        value: ${{ jobs.changes.outputs.app-changed }}
```

- [ ] **Step 9: Group the app's Dependabot updates**

In `.github/dependabot.yml`, add an ignore-free second npm entry for the app directory, so its updates never mix with the core package's:

```yaml
  - package-ecosystem: npm
    directory: /packages/app
    schedule:
      interval: weekly
    commit-message:
      prefix: chore
      include: scope
    groups:
      app-expo:
        patterns: ["expo", "expo-*", "@expo/*", "react", "react-*", "react-native", "react-native-*", "jest-expo", "@testing-library/*"]
    open-pull-requests-limit: 3
```

- [ ] **Step 10: Keep the root audit on the root package**

`npm audit` (which `audit-ci` runs) reads the whole lockfile, workspaces included. In the root `audit-ci.jsonc`, add the scope:

```jsonc
  // Root package only; the app audits its own tree in the App job (packages/app/audit-ci.jsonc).
  "extra-args": ["--workspaces=false"],
```

Run: `make audit` with a full install (`npm ci --ignore-scripts`).
Expected: the same result as on `main` before this branch, with no Expo advisories in the output. If `audit-ci` doesn't accept `extra-args`, or `npm audit --workspaces=false` still reports app packages, try `"extra-args": ["--include-workspace-root", "--workspace=schoolsoft-agent"]`. If nothing scopes the audit, STOP and report back: the root audit must not change.

- [ ] **Step 11: Run shellcheck and actionlint**

Run: `make check-ci`
Expected: exit 0.

- [ ] **Step 12: Commit**

```bash
git add scripts/ci Dockerfile.connector scripts/pack-smoke.sh .github Makefile audit-ci.jsonc
git commit -m "ci: keep the app's dependencies out of every root install"
```

---

### Task 3: The app may import only the typed client

**Files:**
- Modify: `scripts/check-boundaries.ts` (a new rule and doc line)
- Test: `test/boundary/app-imports.test.ts`

**Interfaces:**
- Consumes: the existing `Violation` type in `scripts/check-boundaries.ts`.
- Produces: `export function checkAppImports(rel: string, text: string): Violation[]`, applied to every `.ts`/`.tsx` file under `packages/app/app` and `packages/app/src`.

- [ ] **Step 1: Write the failing test**

`test/boundary/app-imports.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkAppImports } from "../../scripts/check-boundaries.js";

test("the app may import the typed client", () => {
  assert.deepEqual(checkAppImports("app/index.tsx", `import { createClient } from "schoolsoft-agent/client";`), []);
});

test("the app may not import the root package or its sources", () => {
  for (const text of [
    `import { runOperation } from "schoolsoft-agent";`,
    `import x from "schoolsoft-agent/dist/core/index.js";`,
    `import x from "../../../src/core/index.js";`,
    `const x = require("schoolsoft-agent");`,
    `const x = await import("../../src/http/start.js");`,
  ]) {
    assert.equal(checkAppImports("src/x.ts", text).length, 1, text);
  }
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx tsx --test test/boundary/app-imports.test.ts`
Expected: FAIL, "checkAppImports is not exported".

- [ ] **Step 3: Implement the rule**

In `scripts/check-boundaries.ts`, add to the header comment:

```ts
 *   - packages/app/{app,src}/** (the Expo app) imports nothing from the root package but
 *     `schoolsoft-agent/client`, and no root src/ path (docs/planning/specs/2026-09-26-app-workspace.md)
```

and add, exported, next to the other checkers:

```ts
const APP_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["']([^"']+)["']/g;

/** The app's one allowed import from the root package is the typed client. */
export function checkAppImports(rel: string, text: string): Violation[] {
  const out: Violation[] = [];
  for (const m of text.matchAll(APP_SPECIFIER)) {
    const spec = m[1]!;
    const rootPackage = spec === "schoolsoft-agent" || (spec.startsWith("schoolsoft-agent/") && spec !== "schoolsoft-agent/client");
    const rootSource = /(^|\/)src\//.test(spec) && spec.startsWith(".") && spec.split("/").filter((p) => p === "..").length >= 2;
    if (rootPackage || rootSource) {
      out.push({
        file: `packages/app/${rel}`,
        line: text.slice(0, m.index).split("\n").length,
        message: `the app imports only schoolsoft-agent/client, not ${spec}`,
      });
    }
  }
  return out;
}
```

Then, where the script walks files and collects violations, add a walk over `packages/app/app` and `packages/app/src` (both `.ts` and `.tsx`; extend `walk` with an extension parameter defaulting to `[".ts"]`), calling `checkAppImports(relative("packages/app", file), readFileSync(file, "utf8"))`. Skip the walk when `packages/app` doesn't exist.

- [ ] **Step 4: Run it and verify it passes, plus the whole gate**

Run: `npx tsx --test test/boundary/app-imports.test.ts && make boundaries && make coverage`
Expected: PASS; `boundaries: OK`; the root coverage stays at 100% (the new function is fully exercised by the test).

- [ ] **Step 5: Commit**

```bash
git add scripts/check-boundaries.ts test/boundary/app-imports.test.ts
git commit -m "test(boundary): the app imports only the typed client"
```

---

### Task 4: Messages and the connection store

**Files:**
- Create: `packages/app/src/messages.ts`, `packages/app/src/connection/store.ts`
- Test: `packages/app/src/__tests__/messages.test.ts`, `packages/app/src/connection/__tests__/store.test.ts`

**Interfaces:**
- Consumes: `ConnectorError`, `ErrorKind`, `ProblemName`, `Tokens`, `TokenStore` from `schoolsoft-agent/client`.
- Produces:
  - `type Language = "sv" | "en"`
  - `function deviceLanguage(locales: ReadonlyArray<{ languageCode: string | null }>): Language`
  - `function t(lang: Language, key: TextKey): string`, where `TextKey` is the union of the `TEXT.en` keys
  - `interface Explained { title: string; next: string; action: "retry" | "reconnect" | "dashboard" | "wait"; dashboard?: string; retryAt?: string }`
  - `function explain(error: unknown, lang: Language): Explained`
  - `const STORAGE_KEY = "schoolsoft-app-dev"`
  - `interface KeyValue { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }`
  - `interface DevConnection { clientId: string; tokens: Tokens }`
  - `function openStorage(candidate?: () => KeyValue): { storage: KeyValue; persistent: boolean }`
  - `function memoryStorage(): KeyValue`
  - `function readConnection(storage: KeyValue): DevConnection | undefined`
  - `function saveConnection(storage: KeyValue, connection: DevConnection): void`
  - `function forgetConnection(storage: KeyValue): void`
  - `function newDevConnection(clientId: string, refreshToken: string): DevConnection | { invalid: "clientId" | "refreshToken" }`
  - `function tokenStoreFor(storage: KeyValue, clientId: string): TokenStore`

- [ ] **Step 1: Write the failing messages test**

`packages/app/src/__tests__/messages.test.ts`:

```ts
import { ConnectorError, type ErrorKind, type ProblemName } from "schoolsoft-agent/client";
import { deviceLanguage, explain, t } from "../messages";

// Exhaustive by type: a new kind or problem in the client fails `tsc` here until it is listed.
const KINDS: Record<ErrorKind, true> = {
  internal: true, not_authenticated: true, not_configured: true, network: true,
  not_available: true, input: true, upstream: true,
};
const PROBLEMS: Record<ProblemName, true> = {
  "invalid-input": true, "oauth-token": true, "scope-not-granted": true, "child-not-permitted": true,
  "foreign-origin": true, "not-found": true, "schoolsoft-session": true, "web-session": true,
  "rate-limited": true, internal: true, "not-implemented": true, "response-drift": true, upstream: true,
  "connector-busy": true, "portal-pushback": true, "not-available": true, network: true,
};

const err = (kind: ErrorKind, problem: ProblemName | null, body?: Record<string, unknown>) =>
  new ConnectorError({ kind, retryable: false, status: 400, problem, message: "x", body: body as never });

test("device language is Swedish only for a Swedish first locale", () => {
  expect(deviceLanguage([{ languageCode: "sv" }, { languageCode: "en" }])).toBe("sv");
  expect(deviceLanguage([{ languageCode: "en" }, { languageCode: "sv" }])).toBe("en");
  expect(deviceLanguage([{ languageCode: null }])).toBe("en");
  expect(deviceLanguage([])).toBe("en");
});

test("every kind and every problem has a message in both languages", () => {
  for (const lang of ["sv", "en"] as const) {
    for (const kind of Object.keys(KINDS) as ErrorKind[]) {
      const e = explain(err(kind, null), lang);
      expect(e.title.length).toBeGreaterThan(0);
      expect(e.next.length).toBeGreaterThan(0);
    }
    for (const problem of Object.keys(PROBLEMS) as ProblemName[]) {
      const e = explain(err("upstream", problem), lang);
      expect(e.title.length).toBeGreaterThan(0);
    }
  }
});

test("a spent or revoked grant asks to connect again", () => {
  expect(explain(err("not_authenticated", "oauth-token"), "en").action).toBe("reconnect");
  expect(explain(err("not_authenticated", null), "en").action).toBe("reconnect");
  expect(explain(err("input", "scope-not-granted"), "en").action).toBe("reconnect");
});

test("a SchoolSoft sign-in points to the dashboard it names", () => {
  const e = explain(err("not_authenticated", "schoolsoft-session", { ownerDashboard: "https://c.example/owner" }), "en");
  expect(e).toMatchObject({ action: "dashboard", dashboard: "https://c.example/owner" });
});

test("push-back waits and carries retryAt", () => {
  const e = explain(err("upstream", "portal-pushback", { retryAt: "2026-09-26T12:00:00Z" }), "sv");
  expect(e).toMatchObject({ action: "wait", retryAt: "2026-09-26T12:00:00Z" });
  expect(explain(err("upstream", "rate-limited"), "en").action).toBe("wait");
  expect(explain(err("upstream", "connector-busy"), "en").action).toBe("wait");
});

test("anything that is not a ConnectorError is an unexpected error with retry", () => {
  expect(explain(new Error("boom"), "en")).toMatchObject({ action: "retry" });
  expect(explain("boom", "sv")).toMatchObject({ action: "retry" });
});

test("t returns the text in the chosen language", () => {
  expect(t("sv", "children")).toBe("Barn");
  expect(t("en", "children")).toBe("Children");
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npm test --workspace packages/app -- src/__tests__/messages.test.ts`
Expected: FAIL, "Cannot find module '../messages'".

- [ ] **Step 3: Implement `messages.ts`**

`packages/app/src/messages.ts`:

```ts
import { ConnectorError, type ProblemName } from "schoolsoft-agent/client";

export type Language = "sv" | "en";

export function deviceLanguage(locales: ReadonlyArray<{ languageCode: string | null }>): Language {
  return locales[0]?.languageCode === "sv" ? "sv" : "en";
}

const TEXT = {
  en: {
    appName: "SchoolSoft",
    children: "Children",
    loading: "Loading…",
    empty: "This connection covers no children. Connect again and choose at least one child.",
    retry: "Try again",
    forget: "Forget this connection",
    signInLater: "Sign-in arrives in a later version of the app.",
    notPersistent: "This browser blocks storage, so the connection lasts until you reload.",
    devTitle: "Connect for development",
    devClientId: "Client ID",
    devRefresh: "Refresh token",
    devConnect: "Connect",
    devHowTo: "Open the connector's /reference/ page, connect it, then run this in its browser console:",
    devWarning: "Close the reference page tab before connecting. The refresh token rotates: if that tab refreshes later, the whole connection is revoked. Don't paste the same token into two tabs.",
    devInvalidClientId: "Paste the client ID (no spaces).",
    devInvalidRefresh: "Paste the refresh token.",
  },
  sv: {
    appName: "SchoolSoft",
    children: "Barn",
    loading: "Hämtar…",
    empty: "Den här anslutningen gäller inga barn. Anslut igen och välj minst ett barn.",
    retry: "Försök igen",
    forget: "Glöm den här anslutningen",
    signInLater: "Inloggning kommer i en senare version av appen.",
    notPersistent: "Webbläsaren blockerar lagring, så anslutningen gäller tills du laddar om sidan.",
    devTitle: "Anslut för utveckling",
    devClientId: "Klient-id",
    devRefresh: "Uppdateringstoken",
    devConnect: "Anslut",
    devHowTo: "Öppna anslutarens /reference/-sida, anslut den och kör sedan detta i dess webbläsarkonsol:",
    devWarning: "Stäng fliken med referenssidan innan du ansluter. Uppdateringstoken byts ut: om den fliken uppdaterar senare återkallas hela anslutningen. Klistra inte in samma token i två flikar.",
    devInvalidClientId: "Klistra in klient-id (utan mellanslag).",
    devInvalidRefresh: "Klistra in uppdateringstoken.",
  },
} as const satisfies Record<Language, Record<string, string>>;

export type TextKey = keyof (typeof TEXT)["en"];

export function t(lang: Language, key: TextKey): string {
  return TEXT[lang][key];
}

export interface Explained {
  title: string;
  next: string;
  action: "retry" | "reconnect" | "dashboard" | "wait";
  dashboard?: string;
  retryAt?: string;
}

type Line = { sv: [string, string]; en: [string, string]; action: Explained["action"] };

const RECONNECT: Line = {
  en: ["The connection has ended.", "Connect again."],
  sv: ["Anslutningen har upphört.", "Anslut igen."],
  action: "reconnect",
};
const DASHBOARD: Line = {
  en: ["The connector needs a new SchoolSoft sign-in.", "Sign in on the connector's dashboard, then try again."],
  sv: ["Anslutaren behöver en ny inloggning i SchoolSoft.", "Logga in på anslutarens översikt och försök igen."],
  action: "dashboard",
};
const WAIT: Line = {
  en: ["SchoolSoft or the connector is busy.", "Wait a moment and try again."],
  sv: ["SchoolSoft eller anslutaren är upptagen.", "Vänta en stund och försök igen."],
  action: "wait",
};
const NETWORK: Line = {
  en: ["The connector can't be reached.", "Check the connection and try again."],
  sv: ["Det går inte att nå anslutaren.", "Kontrollera anslutningen och försök igen."],
  action: "retry",
};
const DRIFT: Line = {
  en: ["SchoolSoft answered in a way the app doesn't recognise.", "Try again later; an update may be needed."],
  sv: ["SchoolSoft svarade på ett sätt appen inte känner igen.", "Försök igen senare; en uppdatering kan behövas."],
  action: "retry",
};
const ORIGIN: Line = {
  en: ["The connector refused this address.", "Open the app from the connector's own address."],
  sv: ["Anslutaren nekade den här adressen.", "Öppna appen från anslutarens egen adress."],
  action: "retry",
};
const GENERIC: Line = {
  en: ["Something went wrong.", "Try again."],
  sv: ["Något gick fel.", "Försök igen."],
  action: "retry",
};

const BY_PROBLEM: Partial<Record<ProblemName, Line>> = {
  "oauth-token": RECONNECT,
  "scope-not-granted": RECONNECT,
  "child-not-permitted": RECONNECT,
  "schoolsoft-session": DASHBOARD,
  "web-session": DASHBOARD,
  "portal-pushback": WAIT,
  "rate-limited": WAIT,
  "connector-busy": WAIT,
  network: NETWORK,
  "response-drift": DRIFT,
  "foreign-origin": ORIGIN,
};

export function explain(error: unknown, lang: Language): Explained {
  let line = GENERIC;
  let dashboard: string | undefined;
  let retryAt: string | undefined;
  if (error instanceof ConnectorError) {
    line =
      (error.problem ? BY_PROBLEM[error.problem] : undefined) ??
      (error.kind === "not_authenticated" ? RECONNECT : error.kind === "network" ? NETWORK : GENERIC);
    dashboard = error.ownerDashboard;
    retryAt = error.retryAt;
  }
  const [title, next] = line[lang];
  return {
    title,
    next,
    action: line.action,
    ...(line.action === "dashboard" && dashboard ? { dashboard } : {}),
    ...(line.action === "wait" && retryAt ? { retryAt } : {}),
  };
}
```

- [ ] **Step 4: Run it and verify it passes**

Run: `npm test --workspace packages/app -- src/__tests__/messages.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing store test**

`packages/app/src/connection/__tests__/store.test.ts`:

```ts
import {
  STORAGE_KEY, forgetConnection, memoryStorage, newDevConnection, openStorage,
  readConnection, saveConnection, tokenStoreFor,
} from "../store";

test("a new development connection starts with an expired access token", () => {
  expect(newDevConnection(" cid ", " rt ")).toEqual({
    clientId: "cid",
    tokens: { accessToken: "", refreshToken: "rt", expiresAt: 0 },
  });
});

test("invalid input names the field", () => {
  expect(newDevConnection("", "rt")).toEqual({ invalid: "clientId" });
  expect(newDevConnection("c id", "rt")).toEqual({ invalid: "clientId" });
  expect(newDevConnection("cid", "  ")).toEqual({ invalid: "refreshToken" });
});

test("save, read and forget round-trip under the app's own key", () => {
  const s = memoryStorage();
  const c = newDevConnection("cid", "rt");
  if ("invalid" in c) throw new Error("unexpected");
  saveConnection(s, c);
  expect(s.getItem(STORAGE_KEY)).not.toBeNull();
  expect(readConnection(s)).toEqual(c);
  forgetConnection(s);
  expect(readConnection(s)).toBeUndefined();
});

test("a corrupt or wrong-shaped entry reads as no connection", () => {
  const s = memoryStorage();
  for (const raw of [
    "{not json",
    JSON.stringify("text"),
    JSON.stringify({ clientId: 5, tokens: { accessToken: "", refreshToken: "r" } }),
    JSON.stringify({ clientId: "", tokens: { accessToken: "", refreshToken: "r" } }),
    JSON.stringify({ clientId: "cid", tokens: null }),
    JSON.stringify({ clientId: "cid", tokens: { accessToken: 1, refreshToken: "r" } }),
    JSON.stringify({ clientId: "cid", tokens: { accessToken: "", refreshToken: 2 } }),
  ]) {
    s.setItem(STORAGE_KEY, raw);
    expect(readConnection(s)).toBeUndefined();
  }
});

test("a connection without a known expiry reads back without one", () => {
  const s = memoryStorage();
  s.setItem(STORAGE_KEY, JSON.stringify({ clientId: "cid", tokens: { accessToken: "a", refreshToken: "r" } }));
  expect(readConnection(s)).toEqual({ clientId: "cid", tokens: { accessToken: "a", refreshToken: "r" } });
});

test("the token store saves rotated tokens and clears the whole connection", async () => {
  const s = memoryStorage();
  const store = tokenStoreFor(s, "cid");
  expect(await store.load()).toBeUndefined();
  await store.save({ accessToken: "a", refreshToken: "r2", expiresAt: 5 });
  expect(readConnection(s)).toEqual({ clientId: "cid", tokens: { accessToken: "a", refreshToken: "r2", expiresAt: 5 } });
  expect(await store.load()).toEqual({ accessToken: "a", refreshToken: "r2", expiresAt: 5 });
  await store.clear();
  expect(readConnection(s)).toBeUndefined();
});

test("openStorage uses the candidate when it works", () => {
  const working = memoryStorage();
  expect(openStorage(() => working)).toEqual({ storage: working, persistent: true });
});

test("openStorage falls back to memory when storage throws or is missing", () => {
  const throwing = openStorage(() => {
    throw new Error("SecurityError");
  });
  expect(throwing.persistent).toBe(false);
  throwing.storage.setItem("k", "v");
  expect(throwing.storage.getItem("k")).toBe("v");
  const missing = openStorage(() => undefined as never);
  expect(missing.persistent).toBe(false);
});

test("openStorage defaults to the browser's sessionStorage", () => {
  // jest-expo/web runs in jsdom, which provides sessionStorage.
  expect(openStorage().persistent).toBe(true);
});
```

- [ ] **Step 6: Run it and verify it fails**

Run: `npm test --workspace packages/app -- src/connection/__tests__/store.test.ts`
Expected: FAIL, "Cannot find module '../store'".

- [ ] **Step 7: Implement `store.ts`**

`packages/app/src/connection/store.ts`:

```ts
import type { Tokens, TokenStore } from "schoolsoft-agent/client";

/** The app's own key; the reference page's `schoolsoft-reference` is never written. */
export const STORAGE_KEY = "schoolsoft-app-dev";

export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface DevConnection {
  clientId: string;
  tokens: Tokens;
}

export function memoryStorage(): KeyValue {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

/** sessionStorage while the tab lives; memory when the browser blocks or lacks storage. */
export function openStorage(
  candidate: () => KeyValue = () => globalThis.sessionStorage,
): { storage: KeyValue; persistent: boolean } {
  try {
    const storage = candidate();
    storage.getItem(STORAGE_KEY);
    return { storage, persistent: true };
  } catch {
    return { storage: memoryStorage(), persistent: false };
  }
}

const isText = (v: unknown): v is string => typeof v === "string";

export function readConnection(storage: KeyValue): DevConnection | undefined {
  try {
    const raw = JSON.parse(storage.getItem(STORAGE_KEY) ?? "null") as unknown;
    if (typeof raw !== "object" || raw === null) return undefined;
    const { clientId, tokens } = raw as { clientId?: unknown; tokens?: Record<string, unknown> };
    if (!isText(clientId) || clientId === "" || typeof tokens !== "object" || tokens === null) return undefined;
    if (!isText(tokens.accessToken) || !isText(tokens.refreshToken)) return undefined;
    return {
      clientId,
      tokens: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        ...(typeof tokens.expiresAt === "number" ? { expiresAt: tokens.expiresAt } : {}),
      },
    };
  } catch {
    return undefined;
  }
}

export function saveConnection(storage: KeyValue, connection: DevConnection): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(connection));
}

export function forgetConnection(storage: KeyValue): void {
  storage.removeItem(STORAGE_KEY);
}

/** An expired, empty access token makes the typed client refresh before the first request. */
export function newDevConnection(
  clientId: string,
  refreshToken: string,
): DevConnection | { invalid: "clientId" | "refreshToken" } {
  const id = clientId.trim();
  const refresh = refreshToken.trim();
  if (id === "" || /\s/.test(id)) return { invalid: "clientId" };
  if (refresh === "") return { invalid: "refreshToken" };
  return { clientId: id, tokens: { accessToken: "", refreshToken: refresh, expiresAt: 0 } };
}

export function tokenStoreFor(storage: KeyValue, clientId: string): TokenStore {
  return {
    load: () => readConnection(storage)?.tokens,
    save: (tokens) => saveConnection(storage, { clientId, tokens }),
    clear: () => forgetConnection(storage),
  };
}
```

- [ ] **Step 8: Run both tests with coverage**

Run: `npm run test:coverage --workspace packages/app -- src/__tests__/messages.test.ts src/connection/__tests__/store.test.ts`
Expected: PASS. Coverage may fail the global threshold only because `src/use-children.ts` doesn't exist yet; if jest reports a missing-file threshold failure, that's expected until Task 5. Every line of `messages.ts` and `store.ts` must show 100%.

- [ ] **Step 9: Commit**

```bash
git add packages/app/src
git commit -m "feat(app): messages and the development connection store"
```

---

### Task 5: Client factory, connection context and the children hook

**Files:**
- Create: `packages/app/src/connection/client.ts`, `packages/app/src/connection/context.tsx`, `packages/app/src/use-children.ts`
- Test: `packages/app/src/connection/__tests__/client.test.ts`, `packages/app/src/connection/__tests__/context.test.tsx`, `packages/app/src/__tests__/use-children.test.tsx`

**Interfaces:**
- Consumes: from Task 4, `KeyValue`, `DevConnection`, `readConnection`, `saveConnection`, `forgetConnection`, `tokenStoreFor`, `openStorage`, and `Language`; from the client, `createClient` and `ConnectorClient`.
- Produces:
  - `function clientFor(connection: DevConnection, storage: KeyValue, options: { origin: string; language: Language; fetch?: typeof fetch }): ConnectorClient`
  - `ConnectionProvider` (props: `{ children: React.ReactNode; storage?: { storage: KeyValue; persistent: boolean }; origin?: string; language?: Language; fetch?: typeof fetch }`)
  - `function useConnection(): { client: ConnectorClient | undefined; connected: boolean; persistent: boolean; language: Language; generation: number; connect(c: DevConnection): void; forget(): void }`
  - `type ChildrenState = { status: "loading" } | { status: "list"; children: Children["children"] } | { status: "empty" } | { status: "error"; error: unknown }`
  - `function useChildren(client: ConnectorClient | undefined, generation: number): { state: ChildrenState; reload(): void }`

- [ ] **Step 1: Write the failing factory test**

`packages/app/src/connection/__tests__/client.test.ts`:

```ts
import { clientFor } from "../client";
import { memoryStorage, newDevConnection, readConnection, saveConnection } from "../store";

function fakeConnector() {
  const calls: string[] = [];
  let refreshes = 0;
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(`${init?.method ?? "GET"} ${url.origin}${url.pathname}`);
    if (url.pathname === "/token") {
      refreshes++;
      await new Promise((r) => setTimeout(r, 5));
      return new Response(JSON.stringify({ access_token: `a${refreshes}`, refresh_token: `r${refreshes}`, token_type: "Bearer", expires_in: 300 }), {
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ children: [{ id: 201, firstName: "Synthetic Alva" }], childInFocus: null }), {
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  return { fetch, calls, refreshes: () => refreshes };
}

test("the client uses the page origin and refreshes once for concurrent calls", async () => {
  const storage = memoryStorage();
  const conn = newDevConnection("cid", "r0");
  if ("invalid" in conn) throw new Error("unexpected");
  saveConnection(storage, conn);
  const connector = fakeConnector();
  const client = clientFor(conn, storage, { origin: "http://localhost:8080", language: "en", fetch: connector.fetch });
  const answers = await Promise.all([client.children(), client.children(), client.children()]);
  expect(answers.map((a) => a.children[0]!.firstName)).toEqual(["Synthetic Alva", "Synthetic Alva", "Synthetic Alva"]);
  expect(connector.refreshes()).toBe(1);
  expect(connector.calls.every((c) => c.includes("http://localhost:8080/"))).toBe(true);
  expect(readConnection(storage)?.tokens.refreshToken).toBe("r1");
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npm test --workspace packages/app -- src/connection/__tests__/client.test.ts`
Expected: FAIL, "Cannot find module '../client'".

- [ ] **Step 3: Implement `client.ts`**

`packages/app/src/connection/client.ts`:

```ts
import { createClient, type ConnectorClient } from "schoolsoft-agent/client";
import type { Language } from "../messages";
import { tokenStoreFor, type DevConnection, type KeyValue } from "./store";

/** The page's own origin: in development the proxy, later the connector itself (E11.10). */
export function clientFor(
  connection: DevConnection,
  storage: KeyValue,
  options: { origin: string; language: Language; fetch?: typeof fetch },
): ConnectorClient {
  return createClient({
    baseUrl: options.origin,
    clientId: connection.clientId,
    tokens: tokenStoreFor(storage, connection.clientId),
    language: options.language,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
}
```

- [ ] **Step 4: Run it and verify it passes**

Run: `npm test --workspace packages/app -- src/connection/__tests__/client.test.ts`
Expected: PASS. If the refresh count is not 1, the typed client's single-flight refresh isn't doing its job. That's a client bug to report, not to work around here.

- [ ] **Step 5: Write the failing context test**

`packages/app/src/connection/__tests__/context.test.tsx`:

```tsx
import { act, renderHook } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { ConnectionProvider, useConnection } from "../context";
import { memoryStorage, newDevConnection, readConnection, saveConnection } from "../store";

const conn = () => {
  const c = newDevConnection("cid", "r0");
  if ("invalid" in c) throw new Error("unexpected");
  return c;
};

function wrapperWith(storage = memoryStorage(), persistent = true) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ConnectionProvider storage={{ storage, persistent }} origin="http://localhost:8080" language="sv">
      {children}
    </ConnectionProvider>
  );
  return { storage, wrapper };
}

test("without a stored connection there is no client", () => {
  const { wrapper } = wrapperWith();
  const { result } = renderHook(() => useConnection(), { wrapper });
  expect(result.current).toMatchObject({ connected: false, client: undefined, persistent: true, language: "sv" });
});

test("a stored connection gives a client; forget clears it and bumps the generation", () => {
  const { storage, wrapper } = wrapperWith();
  saveConnection(storage, conn());
  const { result } = renderHook(() => useConnection(), { wrapper });
  expect(result.current.connected).toBe(true);
  expect(result.current.client).toBeDefined();
  const before = result.current.generation;
  act(() => result.current.forget());
  expect(result.current.connected).toBe(false);
  expect(readConnection(storage)).toBeUndefined();
  expect(result.current.generation).toBe(before + 1);
});

test("connect stores the connection and bumps the generation", () => {
  const { storage, wrapper } = wrapperWith(memoryStorage(), false);
  const { result } = renderHook(() => useConnection(), { wrapper });
  act(() => result.current.connect(conn()));
  expect(result.current).toMatchObject({ connected: true, persistent: false, generation: 1 });
  expect(readConnection(storage)?.clientId).toBe("cid");
});

test("useConnection outside the provider is a programming error", () => {
  expect(() => renderHook(() => useConnection())).toThrow("ConnectionProvider");
});

test("the provider's defaults come from the browser and the device", () => {
  const wrapper = ({ children }: { children: ReactNode }) => <ConnectionProvider>{children}</ConnectionProvider>;
  const { result } = renderHook(() => useConnection(), { wrapper });
  expect(["sv", "en"]).toContain(result.current.language);
  expect(result.current.persistent).toBe(true);
});
```

- [ ] **Step 6: Run it and verify it fails**

Run: `npm test --workspace packages/app -- src/connection/__tests__/context.test.tsx`
Expected: FAIL, "Cannot find module '../context'".

- [ ] **Step 7: Implement `context.tsx`**

`packages/app/src/connection/context.tsx`:

```tsx
import { getLocales } from "expo-localization";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { ConnectorClient } from "schoolsoft-agent/client";
import { deviceLanguage, type Language } from "../messages";
import { clientFor } from "./client";
import { forgetConnection, openStorage, readConnection, saveConnection, type DevConnection, type KeyValue } from "./store";

interface ConnectionValue {
  client: ConnectorClient | undefined;
  connected: boolean;
  persistent: boolean;
  language: Language;
  /** Changes on every connect or forget, so hooks drop answers from an earlier connection. */
  generation: number;
  connect(connection: DevConnection): void;
  forget(): void;
}

const Context = createContext<ConnectionValue | undefined>(undefined);

export function ConnectionProvider(props: {
  children: ReactNode;
  storage?: { storage: KeyValue; persistent: boolean };
  origin?: string;
  language?: Language;
  fetch?: typeof fetch;
}) {
  const [{ storage, persistent }] = useState(() => props.storage ?? openStorage());
  const [language] = useState(() => props.language ?? deviceLanguage(getLocales()));
  const origin = props.origin ?? globalThis.location.origin;
  const [generation, setGeneration] = useState(0);
  const [connection, setConnection] = useState(() => readConnection(storage));

  const connect = useCallback(
    (next: DevConnection) => {
      saveConnection(storage, next);
      setConnection(next);
      setGeneration((g) => g + 1);
    },
    [storage],
  );
  const forget = useCallback(() => {
    forgetConnection(storage);
    setConnection(undefined);
    setGeneration((g) => g + 1);
  }, [storage]);

  const client = useMemo(
    () => (connection ? clientFor(connection, storage, { origin, language, fetch: props.fetch }) : undefined),
    // A new client per connection; token rotation is kept in storage, not in React state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [generation, connection?.clientId],
  );

  const value = useMemo<ConnectionValue>(
    () => ({ client, connected: client !== undefined, persistent, language, generation, connect, forget }),
    [client, persistent, language, generation, connect, forget],
  );
  return <Context.Provider value={value}>{props.children}</Context.Provider>;
}

export function useConnection(): ConnectionValue {
  const value = useContext(Context);
  if (!value) throw new Error("useConnection needs a ConnectionProvider");
  return value;
}
```

- [ ] **Step 8: Run it and verify it passes**

Run: `npm test --workspace packages/app -- src/connection/__tests__/context.test.tsx`
Expected: PASS.

- [ ] **Step 9: Write the failing hook test**

`packages/app/src/__tests__/use-children.test.tsx`:

```tsx
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ConnectorClient } from "schoolsoft-agent/client";
import { useChildren } from "../use-children";

function fakeClient(answers: Array<() => Promise<unknown>>): ConnectorClient {
  let i = 0;
  return { children: () => answers[Math.min(i++, answers.length - 1)]!() } as unknown as ConnectorClient;
}
const list = (names: string[]) => async () => ({ children: names.map((firstName, id) => ({ id, firstName })), childInFocus: null });

test("without a client the state stays loading", () => {
  const { result } = renderHook(() => useChildren(undefined, 0));
  expect(result.current.state).toEqual({ status: "loading" });
});

test("loading, then the list", async () => {
  const { result } = renderHook(() => useChildren(fakeClient([list(["Alva", "Bo"])]), 0));
  expect(result.current.state.status).toBe("loading");
  await waitFor(() => expect(result.current.state.status).toBe("list"));
  expect(result.current.state).toMatchObject({ children: [{ firstName: "Alva" }, { firstName: "Bo" }] });
});

test("an empty grant is empty, not an empty list", async () => {
  const { result } = renderHook(() => useChildren(fakeClient([list([])]), 0));
  await waitFor(() => expect(result.current.state).toEqual({ status: "empty" }));
});

test("a failure is an error state, and reload tries again", async () => {
  const boom = new Error("boom");
  const client = fakeClient([() => Promise.reject(boom), list(["Alva"])]);
  const { result } = renderHook(() => useChildren(client, 0));
  await waitFor(() => expect(result.current.state).toEqual({ status: "error", error: boom }));
  act(() => result.current.reload());
  await waitFor(() => expect(result.current.state.status).toBe("list"));
});

test("a late answer from an earlier connection is dropped", async () => {
  let release!: () => void;
  const slow = () => new Promise<unknown>((r) => (release = () => r({ children: [{ id: 1, firstName: "Old" }], childInFocus: null })));
  const { result, rerender } = renderHook(({ c, g }: { c: ConnectorClient; g: number }) => useChildren(c, g), {
    initialProps: { c: fakeClient([slow]), g: 0 },
  });
  rerender({ c: fakeClient([list(["New"])]), g: 1 });
  await waitFor(() => expect(result.current.state).toMatchObject({ children: [{ firstName: "New" }] }));
  await act(async () => release());
  expect(result.current.state).toMatchObject({ children: [{ firstName: "New" }] });
});

test("a late failure from an earlier connection is dropped too", async () => {
  let fail!: () => void;
  const slow = () => new Promise<unknown>((_r, reject) => (fail = () => reject(new Error("old"))));
  const { result, rerender } = renderHook(({ c, g }: { c: ConnectorClient; g: number }) => useChildren(c, g), {
    initialProps: { c: fakeClient([slow]), g: 0 },
  });
  rerender({ c: fakeClient([list(["New"])]), g: 1 });
  await waitFor(() => expect(result.current.state).toMatchObject({ children: [{ firstName: "New" }] }));
  await act(async () => fail());
  expect(result.current.state).toMatchObject({ children: [{ firstName: "New" }] });
});
```

- [ ] **Step 10: Run it and verify it fails**

Run: `npm test --workspace packages/app -- src/__tests__/use-children.test.tsx`
Expected: FAIL, "Cannot find module '../use-children'".

- [ ] **Step 11: Implement `use-children.ts`**

`packages/app/src/use-children.ts`:

```ts
import { useCallback, useEffect, useState } from "react";
import type { Children, ConnectorClient } from "schoolsoft-agent/client";

export type ChildrenState =
  | { status: "loading" }
  | { status: "list"; children: Children["children"] }
  | { status: "empty" }
  | { status: "error"; error: unknown };

/** `generation` changes on connect/forget: an answer that started before it is ignored. */
export function useChildren(client: ConnectorClient | undefined, generation: number) {
  const [state, setState] = useState<ChildrenState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!client) return;
    let current = true;
    setState({ status: "loading" });
    client.children().then(
      (answer) => {
        if (!current) return;
        setState(answer.children.length === 0 ? { status: "empty" } : { status: "list", children: answer.children });
      },
      (error: unknown) => {
        if (current) setState({ status: "error", error });
      },
    );
    return () => {
      current = false;
    };
  }, [client, generation, attempt]);

  const reload = useCallback(() => setAttempt((a) => a + 1), []);
  return { state, reload };
}
```

- [ ] **Step 12: Run the whole app suite with the coverage gate**

Run: `npm run test:coverage --workspace packages/app`
Expected: PASS, with 100% on `src/connection/**`, `src/messages.ts` and `src/use-children.ts`.

- [ ] **Step 13: Commit**

```bash
git add packages/app/src
git commit -m "feat(app): client factory, connection context and the children hook"
```

---

### Task 6: Screens and the production export check

**Files:**
- Modify: `packages/app/app/_layout.tsx`, `packages/app/app/index.tsx`
- Create: `packages/app/app/dev-connect.tsx`, `packages/app/src/dev/DevConnect.tsx`, `packages/app/src/ui/ErrorView.tsx`, `packages/app/scripts/check-export.mjs`
- Delete: `packages/app/app/__tests__/smoke.test.tsx`
- Test: `packages/app/app/__tests__/index.test.tsx`, `packages/app/src/dev/__tests__/DevConnect.test.tsx`

**Interfaces:**
- Consumes: `useConnection`, `ConnectionProvider`, `useChildren`, `explain`, `t`, `newDevConnection`.
- Produces: routes `/` and `/dev-connect`; `DEV_MARKER = "schoolsoft-app-dev-connect"` rendered as `testID` on the DevConnect root (the export check looks for this string).

- [ ] **Step 1: Write the failing screen tests**

`packages/app/app/__tests__/index.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { ConnectionProvider } from "../../src/connection/context";
import { memoryStorage, newDevConnection, saveConnection } from "../../src/connection/store";
import Index from "../index";

// React Native renders strings only inside <Text>, so the mock returns one.
jest.mock("expo-router", () => {
  const { Text } = jest.requireActual<typeof import("react-native")>("react-native");
  return { Redirect: ({ href }: { href: string }) => <Text>{`redirect:${href}`}</Text> };
});

function withConnection(fetch: typeof globalThis.fetch, connected = true) {
  const storage = memoryStorage();
  const c = newDevConnection("cid", "r0");
  if (connected && !("invalid" in c)) saveConnection(storage, c);
  return ({ children }: { children: ReactNode }) => (
    <ConnectionProvider storage={{ storage, persistent: true }} origin="http://localhost:8080" language="en" fetch={fetch}>
      {children}
    </ConnectionProvider>
  );
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const token = json({ access_token: "a", refresh_token: "r1", token_type: "Bearer", expires_in: 300 });

test("lists the children's first names", async () => {
  const fetch = (async (u: RequestInfo | URL) =>
    String(u).endsWith("/token") ? token.clone() : json({ children: [{ id: 1, firstName: "Synthetic Alva" }, { id: 2, firstName: "Synthetic Bo" }], childInFocus: null })) as typeof globalThis.fetch;
  render(<Index />, { wrapper: withConnection(fetch) });
  await waitFor(() => expect(screen.getByText("Synthetic Alva")).toBeTruthy());
  expect(screen.getByText("Synthetic Bo")).toBeTruthy();
});

test("an empty grant says so", async () => {
  const fetch = (async (u: RequestInfo | URL) =>
    String(u).endsWith("/token") ? token.clone() : json({ children: [], childInFocus: null })) as typeof globalThis.fetch;
  render(<Index />, { wrapper: withConnection(fetch) });
  await waitFor(() => expect(screen.getByText(/covers no children/)).toBeTruthy());
});

test("a spent refresh token asks to connect again and offers to forget", async () => {
  const fetch = (async () => json({ error: "invalid_grant" }, 400)) as typeof globalThis.fetch;
  render(<Index />, { wrapper: withConnection(fetch) });
  await waitFor(() => expect(screen.getByText("The connection has ended.")).toBeTruthy());
  fireEvent.press(screen.getByText("Forget this connection"));
  await waitFor(() => expect(screen.getByText("redirect:/dev-connect")).toBeTruthy());
});

test("without a connection a development build goes to dev-connect", () => {
  const fetch = (async () => json({})) as typeof globalThis.fetch;
  render(<Index />, { wrapper: withConnection(fetch, false) });
  expect(screen.getByText("redirect:/dev-connect")).toBeTruthy();
});
```

`packages/app/src/dev/__tests__/DevConnect.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { ConnectionProvider } from "../../connection/context";
import { memoryStorage, readConnection } from "../../connection/store";
import { DevConnect } from "../DevConnect";

const replace = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ replace }) }));

function setup() {
  const storage = memoryStorage();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ConnectionProvider storage={{ storage, persistent: true }} origin="http://localhost:8080" language="en">
      {children}
    </ConnectionProvider>
  );
  render(<DevConnect />, { wrapper });
  return storage;
}

test("shows the console command and the rotation warning", () => {
  setup();
  expect(screen.getByText(/sessionStorage.getItem\("schoolsoft-reference"\)/)).toBeTruthy();
  expect(screen.getByText(/Close the reference page tab/)).toBeTruthy();
});

test("validates both fields before saving", () => {
  const storage = setup();
  fireEvent.press(screen.getByText("Connect"));
  expect(screen.getByText("Paste the client ID (no spaces).")).toBeTruthy();
  fireEvent.changeText(screen.getByLabelText("Client ID"), "cid");
  fireEvent.press(screen.getByText("Connect"));
  expect(screen.getByText("Paste the refresh token.")).toBeTruthy();
  expect(readConnection(storage)).toBeUndefined();
});

test("saves and goes to the children list", () => {
  const storage = setup();
  fireEvent.changeText(screen.getByLabelText("Client ID"), "cid");
  fireEvent.changeText(screen.getByLabelText("Refresh token"), "rt");
  fireEvent.press(screen.getByText("Connect"));
  expect(readConnection(storage)).toMatchObject({ clientId: "cid", tokens: { refreshToken: "rt", expiresAt: 0 } });
  expect(replace).toHaveBeenCalledWith("/");
});
```

- [ ] **Step 2: Run them and verify they fail**

Run: `npm test --workspace packages/app -- app/__tests__/index.test.tsx src/dev/__tests__/DevConnect.test.tsx`
Expected: FAIL, "Cannot find module '../DevConnect'" and assertion failures in index.

- [ ] **Step 3: Implement the screens**

`packages/app/src/ui/ErrorView.tsx`:

```tsx
import { Linking, Pressable, Text, View } from "react-native";
import { explain, t, type Language } from "../messages";

export function ErrorView(props: { error: unknown; language: Language; onRetry(): void; onForget(): void }) {
  const e = explain(props.error, props.language);
  return (
    <View accessibilityRole="alert">
      <Text>{e.title}</Text>
      <Text>{e.next}</Text>
      {e.action === "dashboard" && e.dashboard ? (
        <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(e.dashboard!)}>
          <Text>{e.dashboard}</Text>
        </Pressable>
      ) : null}
      {e.action === "reconnect" ? null : (
        <Pressable accessibilityRole="button" onPress={props.onRetry}>
          <Text>{t(props.language, "retry")}</Text>
        </Pressable>
      )}
      <Pressable accessibilityRole="button" onPress={props.onForget}>
        <Text>{t(props.language, "forget")}</Text>
      </Pressable>
    </View>
  );
}
```

`packages/app/app/index.tsx`:

```tsx
import { Redirect } from "expo-router";
import { Text, View } from "react-native";
import { useConnection } from "../src/connection/context";
import { t } from "../src/messages";
import { ErrorView } from "../src/ui/ErrorView";
import { useChildren } from "../src/use-children";

export default function Index() {
  const { client, connected, persistent, language, generation, forget } = useConnection();
  const { state, reload } = useChildren(client, generation);

  if (!connected) {
    return __DEV__ ? <Redirect href="/dev-connect" /> : <Text>{t(language, "signInLater")}</Text>;
  }
  return (
    <View>
      <Text accessibilityRole="header">{t(language, "children")}</Text>
      {persistent ? null : <Text>{t(language, "notPersistent")}</Text>}
      {state.status === "loading" ? <Text>{t(language, "loading")}</Text> : null}
      {state.status === "empty" ? <Text>{t(language, "empty")}</Text> : null}
      {state.status === "list"
        ? state.children.map((child) => <Text key={child.id}>{child.firstName}</Text>)
        : null}
      {state.status === "error" ? (
        <ErrorView error={state.error} language={language} onRetry={reload} onForget={forget} />
      ) : null}
    </View>
  );
}
```

`packages/app/src/dev/DevConnect.tsx`:

```tsx
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useConnection } from "../connection/context";
import { newDevConnection } from "../connection/store";
import { t } from "../messages";

/** Marker for the production export check: this string must not ship in a production bundle. */
export const DEV_MARKER = "schoolsoft-app-dev-connect";
const CONSOLE = `JSON.parse(sessionStorage.getItem("schoolsoft-reference")) // client.id and refresh`;

export function DevConnect() {
  const { connect, language } = useConnection();
  const router = useRouter();
  const [clientId, setClientId] = useState("");
  const [refresh, setRefresh] = useState("");
  const [invalid, setInvalid] = useState<"clientId" | "refreshToken" | undefined>();

  const submit = () => {
    const result = newDevConnection(clientId, refresh);
    if ("invalid" in result) return setInvalid(result.invalid);
    connect(result);
    router.replace("/");
  };

  return (
    <View testID={DEV_MARKER}>
      <Text accessibilityRole="header">{t(language, "devTitle")}</Text>
      <Text>{t(language, "devHowTo")}</Text>
      <Text selectable>{CONSOLE}</Text>
      <Text accessibilityRole="alert">{t(language, "devWarning")}</Text>
      <TextInput accessibilityLabel={t(language, "devClientId")} value={clientId} onChangeText={setClientId} autoCapitalize="none" />
      <TextInput accessibilityLabel={t(language, "devRefresh")} value={refresh} onChangeText={setRefresh} autoCapitalize="none" secureTextEntry />
      {invalid === "clientId" ? <Text>{t(language, "devInvalidClientId")}</Text> : null}
      {invalid === "refreshToken" ? <Text>{t(language, "devInvalidRefresh")}</Text> : null}
      <Pressable accessibilityRole="button" onPress={submit}>
        <Text>{t(language, "devConnect")}</Text>
      </Pressable>
    </View>
  );
}
```

`packages/app/app/dev-connect.tsx`:

```tsx
import { Redirect } from "expo-router";
import type { ComponentType } from "react";

// In a production build __DEV__ is false, so the minifier drops the require and DevConnect with it.
const DevConnect: ComponentType | null = __DEV__
  ? (require("../src/dev/DevConnect") as { DevConnect: ComponentType }).DevConnect
  : null;

export default function DevConnectRoute() {
  return DevConnect ? <DevConnect /> : <Redirect href="/" />;
}
```

`packages/app/app/_layout.tsx`:

```tsx
import { Stack } from "expo-router";
import { ConnectionProvider } from "../src/connection/context";

export default function Layout() {
  return (
    <ConnectionProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </ConnectionProvider>
  );
}
```

Delete `packages/app/app/__tests__/smoke.test.tsx`.

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm run test:coverage --workspace packages/app`
Expected: PASS; the plumbing gate stays at 100%.

- [ ] **Step 5: Write the production export check**

`packages/app/scripts/check-export.mjs`:

```js
// Fails when development-only code reaches a production web export (spec: Production safety).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] ?? "dist-web";
const FORBIDDEN = ["schoolsoft-app-dev-connect", "schoolsoft-reference", "dev-proxy"];
const files = [];
(function walk(d) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(js|html)$/.test(p)) files.push(p);
  }
})(dir);
if (files.length === 0) {
  console.error(`no .js or .html files in ${dir}; run the export first`);
  process.exit(1);
}
const found = [];
for (const f of files) {
  const text = readFileSync(f, "utf8");
  for (const s of FORBIDDEN) if (text.includes(s)) found.push(`${f}: ${s}`);
}
if (found.length) {
  console.error("development code in the production export:\n" + found.join("\n"));
  process.exit(1);
}
console.log(`production export clean (${files.length} files)`);
```

- [ ] **Step 6: Verify the check fails on a development export and passes on production**

Run: `cd packages/app && npx expo export --platform web --dev --output-dir /tmp/app-dev && node scripts/check-export.mjs /tmp/app-dev; echo "dev exit=$?"`
Expected: `dev exit=1`, listing `schoolsoft-app-dev-connect`. This proves the check can see the marker.

Run: `npm run export:web && node scripts/check-export.mjs dist-web; cd ../..`
Expected: "production export clean (N files)".

- [ ] **Step 7: Lint, typecheck, commit**

Run: `npm run lint --workspace packages/app && npm run typecheck --workspace packages/app`
Expected: exit 0.

```bash
git add packages/app
git commit -m "feat(app): children list, development connect screen and the production export check"
```

---

### Task 7: Development proxy and `make app-web`

**Files:**
- Create: `packages/app/scripts/dev-proxy.mjs`, `packages/app/scripts/dev-web.mjs`
- Modify: `Makefile`
- Test: `packages/app/scripts/dev-proxy.test.mjs` (node:test)

**Interfaces:**
- Produces:
  - `export function upstreamFor(pathname: string): "connector" | "app"`
  - `export function createProxy(options: { connector: URL; app: URL } | { connector: URL; staticDir: string }): http.Server`
  - `export async function checkConnector(connector: URL, fetchImpl = fetch): Promise<void>`, which throws `Error` naming the URL
  - CLI: `node scripts/dev-web.mjs --connector <url> [--port 8080] [--static <dir>]`, which prints `ready http://localhost:<port>` when serving

- [ ] **Step 1: Write the failing proxy test**

`packages/app/scripts/dev-proxy.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkConnector, createProxy, upstreamFor } from "./dev-proxy.mjs";

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return new URL(`http://127.0.0.1:${server.address().port}`);
}
function echo(name) {
  return http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ name, path: req.url, origin: req.headers.origin ?? null, host: req.headers.host }));
  });
}

test("routes the connector's paths and nothing else", () => {
  for (const p of ["/api/v1/children", "/api/v1/session", "/token", "/revoke", "/.well-known/oauth-authorization-server"])
    assert.equal(upstreamFor(p), "connector", p);
  for (const p of ["/", "/dev-connect", "/_expo/static/js/web/entry.js", "/api", "/tokens", "/api/v2/x"])
    assert.equal(upstreamFor(p), "app", p);
});

test("rewrites Origin and Host for the connector only", async () => {
  const connectorServer = echo("connector");
  const appServer = echo("app");
  const connector = await listen(connectorServer);
  const app = await listen(appServer);
  const proxy = createProxy({ connector, app });
  const base = await listen(proxy);
  try {
    const c = await (await fetch(new URL("/api/v1/children", base), { headers: { origin: base.origin } })).json();
    assert.deepEqual([c.name, c.origin, c.host], ["connector", connector.origin, connector.host]);
    const a = await (await fetch(new URL("/dev-connect", base), { headers: { origin: base.origin } })).json();
    assert.deepEqual([a.name, a.origin], ["app", base.origin]);
  } finally {
    for (const s of [proxy, connectorServer, appServer]) s.close();
  }
});

test("serves a static export with a single-page fallback", async () => {
  const dir = mkdtempSync(join(tmpdir(), "app-static-"));
  writeFileSync(join(dir, "index.html"), "<html>app</html>");
  writeFileSync(join(dir, "main.js"), "console.log(1)");
  const connectorServer = echo("connector");
  const connector = await listen(connectorServer);
  const proxy = createProxy({ connector, staticDir: dir });
  const base = await listen(proxy);
  try {
    assert.equal(await (await fetch(new URL("/main.js", base))).text(), "console.log(1)");
    assert.equal(await (await fetch(new URL("/dev-connect", base))).text(), "<html>app</html>");
    assert.equal(await (await fetch(new URL("/../../etc/passwd", base))).text(), "<html>app</html>");
  } finally {
    proxy.close();
    connectorServer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an unreachable upstream answers 502, not a hang", async () => {
  const proxy = createProxy({ connector: new URL("http://127.0.0.1:9"), app: new URL("http://127.0.0.1:9") });
  const base = await listen(proxy);
  try {
    assert.equal((await fetch(new URL("/api/v1/children", base))).status, 502);
  } finally {
    proxy.close();
  }
});

test("checkConnector names the URL when the connector is unreachable or unhealthy", async () => {
  await assert.rejects(checkConnector(new URL("http://127.0.0.1:9")), /http:\/\/127\.0\.0\.1:9/);
  const bad = http.createServer((_q, r) => { r.statusCode = 500; r.end(); });
  const url = await listen(bad);
  try {
    await assert.rejects(checkConnector(url), new RegExp(url.origin.replace(/[.]/g, "\\.")));
  } finally {
    bad.close();
  }
});

function connectorWithIssuer(issuer) {
  return http.createServer((req, res) => {
    if (req.url === "/healthz") return res.end("ok");
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ issuer: typeof issuer === "function" ? issuer() : issuer }));
  });
}

test("checkConnector refuses a URL that is not the connector's public URL", async () => {
  // Reached as 127.0.0.1, but the connector says it is localhost: every REST call would be foreign-origin.
  let port;
  const server = connectorWithIssuer(() => `http://localhost:${port}/`);
  const url = await listen(server);
  port = url.port;
  try {
    await assert.rejects(checkConnector(url), /doesn't match the connector's public URL http:\/\/localhost:/);
  } finally {
    server.close();
  }
});

test("checkConnector accepts the connector's own public URL", async () => {
  let origin;
  const server = connectorWithIssuer(() => `${origin}/`);
  const url = await listen(server);
  origin = url.origin;
  try {
    await checkConnector(url);
  } finally {
    server.close();
  }
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `node --test packages/app/scripts/dev-proxy.test.mjs`
Expected: FAIL, "Cannot find module … dev-proxy.mjs".

- [ ] **Step 3: Implement the proxy**

`packages/app/scripts/dev-proxy.mjs`:

```js
// Development only: one origin for the app and the connector (spec: Development proxy).
// Rewrites only the upstream address, Host, and Origin on connector-bound requests.
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";

const CONNECTOR_PATHS = [/^\/api\/v1(\/|$)/, /^\/token$/, /^\/revoke$/, /^\/\.well-known\//];
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

export function upstreamFor(pathname) {
  return CONNECTOR_PATHS.some((r) => r.test(pathname)) ? "connector" : "app";
}

function forward(req, res, target, rewriteOrigin) {
  const headers = { ...req.headers, host: target.host };
  if (rewriteOrigin && headers.origin) headers.origin = target.origin;
  const lib = target.protocol === "https:" ? https : http;
  const upstream = lib.request(
    { protocol: target.protocol, hostname: target.hostname, port: target.port, path: req.url, method: req.method, headers },
    (answer) => {
      res.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(res);
    },
  );
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
    res.end("upstream unreachable");
  });
  req.pipe(upstream);
}

function serveStatic(req, res, dir) {
  const root = resolve(dir);
  const pathname = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const candidate = resolve(join(root, normalize(pathname)));
  const inside = candidate === root || candidate.startsWith(root + sep);
  const file = inside && existsSync(candidate) && statSync(candidate).isFile() ? candidate : join(root, "index.html");
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
}

export function createProxy(options) {
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, "http://x").pathname;
    if (upstreamFor(pathname) === "connector") return forward(req, res, options.connector, true);
    if ("staticDir" in options) return serveStatic(req, res, options.staticDir);
    return forward(req, res, options.app, false);
  });
  // The dev server's hot-reload socket.
  server.on("upgrade", (req, socket, head) => {
    if (!("app" in options)) return socket.destroy();
    const target = options.app;
    const upstream = net.connect(Number(target.port), target.hostname, () => {
      const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
      for (const [k, v] of Object.entries({ ...req.headers, host: target.host })) lines.push(`${k}: ${v}`);
      upstream.write(lines.join("\r\n") + "\r\n\r\n");
      upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
  });
  return server;
}

/** Healthy, and reached at its own public URL (the REST surface refuses any other Origin). */
export async function checkConnector(connector, fetchImpl = fetch) {
  let status;
  try {
    status = (await fetchImpl(new URL("/healthz", connector))).status;
  } catch (cause) {
    throw new Error(`the connector at ${connector.origin} can't be reached`, { cause });
  }
  if (status !== 200) throw new Error(`the connector at ${connector.origin} answered ${status} on /healthz`);
  const metadata = await (await fetchImpl(new URL("/.well-known/oauth-authorization-server", connector))).json();
  const publicOrigin = new URL(metadata.issuer).origin;
  if (publicOrigin !== connector.origin) {
    throw new Error(`${connector.origin} doesn't match the connector's public URL ${publicOrigin}`);
  }
}
```

- [ ] **Step 4: Run it and verify it passes**

Run: `node --test packages/app/scripts/dev-proxy.test.mjs`
Expected: PASS (7 tests).

- [ ] **Step 5: Write the launcher**

`packages/app/scripts/dev-web.mjs`:

```js
// `make app-web`: check the connector, start Expo's web dev server (or serve a static export), put the proxy in front.
import { spawn } from "node:child_process";
import { parseArgs } from "node:util";
import { checkConnector, createProxy } from "./dev-proxy.mjs";

const { values } = parseArgs({
  options: { connector: { type: "string" }, port: { type: "string", default: "8080" }, static: { type: "string" } },
});
if (!values.connector) {
  console.error("--connector is required, e.g. --connector http://localhost:3000");
  process.exit(2);
}
const connector = new URL(values.connector);
try {
  await checkConnector(connector);
} catch (error) {
  console.error(`${error.message}. CONNECTOR_URL must be the connector's SCHOOLSOFT_PUBLIC_URL.`);
  process.exit(1);
}
const port = Number(values.port);
let expo;
let proxy;
if (values.static) {
  proxy = createProxy({ connector, staticDir: values.static });
} else {
  const appPort = port + 1;
  expo = spawn("npx", ["expo", "start", "--web", "--port", String(appPort)], { stdio: "inherit", env: { ...process.env, BROWSER: "none", CI: "1" } });
  proxy = createProxy({ connector, app: new URL(`http://localhost:${appPort}`) });
}
proxy.listen(port, "localhost", () => console.log(`ready http://localhost:${port}`));
const stop = () => {
  proxy.close();
  expo?.kill();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
```

- [ ] **Step 6: Add the make targets**

In `Makefile`, after the E2E section:

```make
# ---------- App (packages/app) ----------

app-check: build ## The app's lint, typecheck, tests with its coverage gate, proxy tests and production export check
	npm run lint --workspace packages/app
	npm run typecheck --workspace packages/app
	npm run test:coverage --workspace packages/app
	node --test packages/app/scripts/dev-proxy.test.mjs
	npm run export:web --workspace packages/app
	node packages/app/scripts/check-export.mjs packages/app/dist-web

app-web: build ## Serve the app on http://localhost:8080 against a running connector: make app-web CONNECTOR_URL=http://localhost:3000
	@test -n "$(CONNECTOR_URL)" || (echo "CONNECTOR_URL is required, e.g. make app-web CONNECTOR_URL=http://localhost:3000" >&2; exit 2)
	cd packages/app && node scripts/dev-web.mjs --connector "$(CONNECTOR_URL)"
```

Add `app-check app-web` (and in Task 8, `app-e2e`) to the `.PHONY` line if the Makefile keeps one.

- [ ] **Step 7: Verify the refusal paths by hand**

Run: `make app-web; echo "exit=$?"`
Expected: "CONNECTOR_URL is required…", `exit=2`.

Run: `make app-web CONNECTOR_URL=http://127.0.0.1:9; echo "exit=$?"`
Expected: "the connector at http://127.0.0.1:9 can't be reached. CONNECTOR_URL must be…", `exit=1`.

- [ ] **Step 8: Commit**

```bash
git add packages/app/scripts Makefile
git commit -m "feat(app): development proxy and make app-web"
```

---

### Task 8: End-to-end test for the done criterion

**Files:**
- Create: `packages/app/e2e/app-web.e2e.test.ts`
- Modify: `Makefile` (`app-e2e`)

**Interfaces:**
- Consumes: `composeConnector` (`src/http/start.js`), `fakeUpstream`, `FAKE_GUARDIAN` and `FAKE_UPSTREAM_CODE` (`test/packaging/connector-smoke/fake-upstream.mjs`), `browserStatus` (`src/core/browser/install.js`), and `createProxy` from Task 7. This is test infrastructure outside the app's `app/` and `src/`, so the Task 3 boundary doesn't apply.

- [ ] **Step 1: Write the test**

`packages/app/e2e/app-web.e2e.test.ts`:

```ts
/**
 * The E11.4 done criterion in real Chromium: a grant from the reference page, pasted into
 * the app's development connect screen, lists the grant's children through the dev proxy.
 * Hermetic: the connector runs against the fake portal; no SchoolSoft.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browserStatus } from "../../../src/core/browser/install.js";
import { composeConnector } from "../../../src/http/start.js";
import type { ConnectorConfig } from "../../../src/http/config.js";
import { FAKE_GUARDIAN, FAKE_UPSTREAM_CODE, fakeUpstream } from "../../../test/packaging/connector-smoke/fake-upstream.mjs";
// @ts-expect-error plain ESM script without types
import { createProxy } from "../scripts/dev-proxy.mjs";

const status = await browserStatus({ kind: "chromium" });
const skip = status.ready ? false : `headless browser not installed (${status.hint})`;
const [ALVA, BO] = FAKE_GUARDIAN.children;

async function freePort(): Promise<number> {
  const probe = (await import("node:net")).createServer().listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((r) => probe.close(() => r()));
  return port;
}

test("the app lists the grant's children from a running connector", { skip, timeout: 240_000 }, async () => {
  const { chromium } = await import("playwright");
  const stateDir = mkdtempSync(join(tmpdir(), "app-web-e2e-"));
  const exportDir = mkdtempSync(join(tmpdir(), "app-web-export-"));
  execFileSync("npx", ["expo", "export", "--platform", "web", "--dev", "--output-dir", exportDir], {
    cwd: join(import.meta.dirname, ".."),
    stdio: "inherit",
  });

  const port = await freePort();
  const config: ConnectorConfig = {
    publicUrl: `http://localhost:${port}`,
    proxyHops: 0,
    adminPassword: "synthetic-admin-password-for-the-app-e2e-0123456789",
    storageKey: Buffer.alloc(32, 9),
    stateDir,
    port,
    school: "synthetic-fixture",
  };
  const { app, runtime } = composeConnector(config, { fetchImpl: fakeUpstream().fetchImpl }, {
    SCHOOLSOFT_REQUESTS_PER_MINUTE: "60",
    SCHOOLSOFT_REQUEST_BURST: "20",
    SCHOOLSOFT_MAX_CONCURRENT_REQUESTS: "4",
  });
  const server = app.listen(port, "127.0.0.1");
  await once(server, "listening");
  const proxyPort = await freePort();
  const proxy = createProxy({ connector: new URL(config.publicUrl), staticDir: exportDir });
  proxy.listen(proxyPort, "127.0.0.1");
  await once(proxy, "listening");
  const browser = await chromium.launch();
  try {
    const { url } = await runtime.beginLogin();
    assert.ok(runtime.callback(decodeURIComponent(/[?&#]state=([^&#]+)/.exec(url)![1]!), FAKE_UPSTREAM_CODE));
    for (let attempt = 0; !(await runtime.status()).authenticated; attempt++) {
      assert.ok(attempt < 50, "the fake sign-in did not complete");
      await new Promise((r) => setTimeout(r, 20));
    }

    // 1. A grant through the reference page, as a developer would get one.
    const ref = await browser.newPage();
    await ref.goto(config.publicUrl + "/reference/");
    await ref.click('[data-action="connect"]');
    await ref.fill('input[name="password"]', config.adminPassword);
    await ref.click('button[type="submit"]');
    await ref.waitForSelector('input[name="children"]');
    await ref.check(`input[name="children"][value="${ALVA.studentId}"]`);
    await ref.check(`input[name="children"][value="${BO.studentId}"]`);
    await ref.click("text=Allow selected access");
    await ref.waitForSelector(`text=${ALVA.firstName}`);
    const saved = JSON.parse((await ref.evaluate(() => sessionStorage.getItem("schoolsoft-reference")))!) as {
      client: { id: string };
      refresh: string;
    };
    await ref.close(); // as the connect screen tells the developer to

    // 2. The app, through the proxy's origin only.
    const page = await browser.newPage();
    const origins = new Set<string>();
    page.on("request", (r) => origins.add(new URL(r.url()).origin));
    const appOrigin = `http://127.0.0.1:${proxyPort}`;
    await page.goto(appOrigin + "/");
    await page.getByLabel("Client ID").fill(saved.client.id);
    await page.getByLabel("Refresh token").fill(saved.refresh);
    await page.getByText("Connect", { exact: true }).click();
    await page.waitForSelector(`text=${ALVA.firstName}`);
    assert.ok(await page.getByText(BO.firstName).isVisible());
    assert.deepEqual([...origins], [appOrigin]);
  } finally {
    await browser.close();
    proxy.close();
    server.close();
    server.closeAllConnections();
    await runtime.close();
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(exportDir, { recursive: true, force: true });
  }
});
```

Note: the app's page runs on `127.0.0.1:<proxyPort>` and the connector on `localhost:<port>`, so the proxy's `Origin` rewrite is exercised for real. Without it, the REST call would be refused as `foreign-origin`.

- [ ] **Step 2: Add the make target**

```make
app-e2e: build ## The E11.4 done criterion in headless Chromium: connector (fake portal) + reference-page grant + app via the dev proxy
	npx tsx --test packages/app/e2e/app-web.e2e.test.ts
```

- [ ] **Step 3: Run it and verify it passes**

Run: `npx playwright install chromium && make app-e2e`
Expected: PASS (1 test). If `expo export --dev` is not supported by the pinned SDK (the command fails with an unknown-option error), switch the test to `spawn("node", ["scripts/dev-web.mjs", "--connector", config.publicUrl, "--port", String(proxyPort)])`, waiting up to 180 seconds for the `ready` line, and note it in the PR (spec clarification 4).

- [ ] **Step 4: Prove it can fail**

Temporarily change `if (rewriteOrigin && headers.origin) headers.origin = target.origin;` to `if (false)` in `dev-proxy.mjs`, run `make app-e2e`, and expect a FAIL (the page shows the "refused this address" error instead of the children). Revert the change and run it again to see it pass.

- [ ] **Step 5: Commit**

```bash
git add packages/app/e2e Makefile
git commit -m "test(app): the app lists a grant's children from a running connector"
```

---

### Task 9: App CI job, audit scope and docs

**Files:**
- Create: `.github/workflows/app.yml`, `packages/app/audit-ci.jsonc`, `docs/development/app.md`
- Modify: `.github/workflows/ci.yml` (call the app workflow), `docs/development/architecture.md`, `CONTRIBUTING.md`, `ROADMAP.md`, `docs/planning/specs/2026-09-26-app-workspace.md` (status and the four clarifications), `docs/planning/README.md` (link the spec and this plan)

**Interfaces:**
- Consumes: `needs.checks.outputs.app-changed` (Task 2), `make app-check` (Task 7) and `make app-e2e` (Task 8).

- [ ] **Step 1: Write the app workflow**

`.github/workflows/app.yml`:

```yaml
name: App

# The Expo app's own job (docs/planning/specs/2026-09-26-app-workspace.md). The root jobs
# never install the app's dependencies; this job installs everything.
on:
  workflow_call:

permissions:
  contents: read

jobs:
  app:
    name: Test
    runs-on: ubuntu-latest
    timeout-minutes: 25
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: "24"
          cache: npm
      - name: Install dependencies (root and the app workspace)
        run: npm ci --ignore-scripts
      - name: Audit the app's dependencies (packages/app/audit-ci.jsonc allowlist)
        run: npx audit-ci --config packages/app/audit-ci.jsonc
      - name: Lint, typecheck, tests with the plumbing gate, proxy tests, production export check
        run: make app-check
      - name: Cache Playwright browsers
        uses: actions/cache@v6
        with:
          path: ~/.cache/ms-playwright
          key: playwright-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
          restore-keys: playwright-${{ runner.os }}-
      - name: Install Chromium
        run: npx playwright install chromium --with-deps
      - name: The app lists a grant's children from a running connector (fake portal)
        run: make app-e2e
```

In `.github/workflows/ci.yml`, add after `unit`:

```yaml
  app:
    name: App
    needs: [checks]
    if: needs.checks.outputs.app-changed == 'true'
    uses: ./.github/workflows/app.yml
```

- [ ] **Step 2: Write the app's audit config**

`packages/app/audit-ci.jsonc`:

```jsonc
{
  // The app's dependencies only. Every allowlisted advisory needs a reason and a review
  // date (spec: Workspace and fences); nothing is ignored silently.
  "$schema": "https://github.com/IBM/audit-ci/raw/main/docs/schema.json",
  "high": true,
  "allowlist": [],
}
```

Run: `npx audit-ci --config packages/app/audit-ci.jsonc`
Expected: exit 0. If high advisories appear in Expo's tree with no fix available, add each to `allowlist` with a `// reason, review by YYYY-MM-DD` comment and list them in the PR description for the owner.

- [ ] **Step 3: Write `docs/development/app.md`**

```markdown
# The app (packages/app)

One Expo project (React Native with react-native-web) for web and phones, built on the
REST surface through the typed client `schoolsoft-agent/client`. Design:
[app workspace spec](../planning/specs/2026-09-26-app-workspace.md).

## Run it against a connector

1. Start a connector (see [the connector guide](../deployment/connector.md)) and sign it in to SchoolSoft.
2. Open its `/reference/` page, connect it and approve at least one child.
3. In that page's browser console, run
   `JSON.parse(sessionStorage.getItem("schoolsoft-reference"))` and copy `client.id` and `refresh`.
4. **Close the reference page tab.** Refresh tokens rotate: if that tab refreshes after the app
   has, the whole connection is revoked. Don't paste one token into two tabs.
5. `make app-web CONNECTOR_URL=http://localhost:3000` (the connector's exact `SCHOOLSOFT_PUBLIC_URL`),
   then open http://localhost:8080 and paste the two values.

The proxy on port 8080 makes the app and the connector one origin: it forwards `/api/v1/*`,
`/token`, `/revoke` and `/.well-known/*` to the connector, rewriting `Origin` to the
connector's, and everything else to Expo's dev server. It exists only in development.

## Checks

- `make app-check`: lint, typecheck, tests (100% on `src/connection/`, `src/messages.ts`,
  `src/use-children.ts`), proxy tests, and a production export that must contain no development code.
- `make app-e2e`: the connector against the fake portal, a grant from the reference page, and the
  app listing the children in headless Chromium.
- CI runs both in the `App / Test` job when the app, the typed client or the dependencies change.
  The root jobs install the root package only and never see Expo.

## Rules

- The app imports nothing from the root package but `schoolsoft-agent/client` (`make boundaries`).
- The development connect screen never ships in a production build.
- Sign-in (E11.5) replaces the connect screen; until then, a production build shows a notice.
```

- [ ] **Step 4: Update the other docs**

- `docs/development/architecture.md`: add an "App workspace" paragraph under the connector/REST section. It should say that `packages/app` is a private npm workspace, imports only `schoolsoft-agent/client`, and is fenced out of root installs, the image and the tarball; and link `app.md`.
- `CONTRIBUTING.md`: in the checks section, add `make app-check` and `make app-e2e`, and note that `make check` stays root-only.
- `ROADMAP.md`: mark E11.4 "(offline; done in #N)" in the repository's "done in #N" style, using the implementation PR's number.
- The spec: set `status: done`, and add a "Clarifications (as built)" section after the frozen block listing the four clarifications from this plan.
- `docs/planning/README.md`: link the spec and this plan.

Run: `make docs-check && make format-check`
Expected: exit 0.

- [ ] **Step 5: Full verification**

Run: `make check && make check-ci && make check-package && make app-check && make app-e2e`
Expected: every command exits 0. Then `rm -rf node_modules && npm ci --ignore-scripts --workspaces=false && bash scripts/ci/assert-root-install.sh && make check`, which must also pass (the root-only path), followed by `npm ci --ignore-scripts` to restore the full install.

- [ ] **Step 6: Commit, push, open the PR**

```bash
git add .github docs CONTRIBUTING.md ROADMAP.md packages/app/audit-ci.jsonc
git commit -m "ci(app): the app's own test job, audit scope and docs"
git push -u origin feat/app-workspace
```

Open the PR with `gh api` (REST), titled `feat(app): the app workspace, listing a grant's children (E11.4)`, ending "Closes #37". Put in the body:

- the pinned Expo SDK version;
- the root-only install proof from Task 2;
- any audit allowlist entries;
- the four spec clarifications.

Wait for CI by polling `gh api repos/grimen/schoolsoft-agent/actions/runs/<id>`, and check the commit's check-runs, including CodeQL and the new `App / Test`.
