/**
 * packages/app/{app,src}/** (the Expo app) imports nothing from the root
 * package but `schoolsoft-agent/client`, and no root src/ path: the checker's
 * app rule in isolation (checkAppImports), and wired into checkBoundaries
 * over a fixture tree (docs/planning/specs/2026-09-26-app-workspace.md).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkAppImports, checkBoundaries } from "../../scripts/check-boundaries.js";

test("the app may import the typed client", () => {
  assert.deepEqual(
    checkAppImports("app/index.tsx", `import { createClient } from "schoolsoft-agent/client";`),
    [],
  );
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

test("the app's own relative imports of its own src/ do not false-positive", () => {
  assert.deepEqual(
    checkAppImports("app/index.tsx", `import { useConnection } from "../src/connection/context";`),
    [],
  );
});

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "app-imports-"));
  mkdirSync(join(root, "src/core"), { recursive: true });
  writeFileSync(join(root, "src/core/index.ts"), "export {};\n");
  return root;
}

test("checkBoundaries skips the app walk when packages/app does not exist", () => {
  const root = makeRoot();
  assert.deepEqual(checkBoundaries(root), []);
});

test("checkBoundaries walks packages/app/app and packages/app/src and reports violations", () => {
  const root = makeRoot();
  mkdirSync(join(root, "packages/app/app/__tests__"), { recursive: true });
  mkdirSync(join(root, "packages/app/src/connection"), { recursive: true });
  writeFileSync(
    join(root, "packages/app/app/index.tsx"),
    [
      `import { createClient } from "schoolsoft-agent/client";`,
      `import { useConnection } from "../src/connection/context";`,
    ].join("\n"),
  );
  writeFileSync(
    join(root, "packages/app/app/__tests__/smoke.test.tsx"),
    `import { runOperation } from "schoolsoft-agent";\n`,
  );
  writeFileSync(
    join(root, "packages/app/src/connection/context.ts"),
    `const x = await import("../../../src/http/start.js");\n`,
  );
  const found = checkBoundaries(root).map((v) => `${v.file}:${v.line}: ${v.message}`);
  assert.deepEqual(found, [
    "packages/app/app/__tests__/smoke.test.tsx:1: the app imports only schoolsoft-agent/client, not schoolsoft-agent",
    "packages/app/src/connection/context.ts:1: the app imports only schoolsoft-agent/client, not ../../../src/http/start.js",
  ]);
});
