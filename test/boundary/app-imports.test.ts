/**
 * packages/app/{app,src}/** (the Expo app) imports nothing from the root
 * package but `schoolsoft-agent/client`, and nothing that resolves outside
 * packages/app (which is where the root package and root src/ live): the
 * checker's app rule in isolation (checkAppImports), and wired into
 * checkBoundaries over a fixture tree
 * (docs/planning/specs/2026-09-26-app-workspace.md, Ruling R11).
 *
 * A relative specifier is judged by where it actually resolves (path.posix
 * against a virtual /packages/app root), not by counting `..` segments, so
 * nested app directories (__tests__, Expo Router groups like (tabs)) and the
 * app's own ../src/... imports are never false positives.
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

test("relative imports that stay inside packages/app are allowed, however nested", () => {
  for (const [rel, text] of [
    [
      "app/__tests__/smoke.test.tsx",
      `import { useConnection } from "../../src/connection/context";`,
    ],
    ["app/(tabs)/week.tsx", `import { useChildren } from "../../src/use-children";`],
    ["src/connection/context.tsx", `import { formatMessage } from "../messages";`],
    ["src/connection/context.tsx", `import { store } from "./store";`],
    ["app/index.tsx", `import { useConnection } from "../src/connection/context";`],
  ] as const) {
    assert.deepEqual(checkAppImports(rel, text), [], `${rel}: ${text}`);
  }
});

test("the app may not import the root package, however it is reached", () => {
  for (const text of [
    `import "schoolsoft-agent";`,
    `import type { X } from "schoolsoft-agent";`,
    `export * from "schoolsoft-agent/dist/core/index.js";`,
  ]) {
    assert.equal(checkAppImports("app/index.tsx", text).length, 1, text);
  }
});

test("the app may not import the root package or its sources", () => {
  for (const text of [
    `import { runOperation } from "schoolsoft-agent";`,
    `import x from "schoolsoft-agent/dist/core/index.js";`,
    `const x = require("schoolsoft-agent");`,
  ]) {
    assert.equal(checkAppImports("src/x.ts", text).length, 1, text);
  }
});

test("a relative specifier that resolves outside packages/app is a violation", () => {
  for (const [rel, text] of [
    [
      "src/connection/client.ts",
      `const x = await import("../../../../src/http/start.js");`, // the real root src/
    ],
    ["app/index.tsx", `import x from "../../../src/core/index.js";`],
    ["src/x.ts", `import y from "../../other-package/y";`], // leaves the workspace entirely
  ] as const) {
    assert.equal(checkAppImports(rel, text).length, 1, text);
  }
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
    // Really reaches the root package's own src/, four levels up from packages/app/src/connection.
    join(root, "packages/app/src/connection/context.ts"),
    `const x = await import("../../../../src/http/start.js");\n`,
  );
  const found = checkBoundaries(root).map((v) => `${v.file}:${v.line}: ${v.message}`);
  assert.deepEqual(found, [
    "packages/app/app/__tests__/smoke.test.tsx:1: the app imports only schoolsoft-agent/client, not schoolsoft-agent",
    "packages/app/src/connection/context.ts:1: the app imports only schoolsoft-agent/client, not ../../../../src/http/start.js",
  ]);
});
