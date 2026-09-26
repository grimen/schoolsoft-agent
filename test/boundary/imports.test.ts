import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkBoundaries } from "../../scripts/check-boundaries.js";

test("the real source tree has no boundary violations", () => {
  const v = checkBoundaries(process.cwd());
  assert.deepEqual(v, []);
});

test("checker catches core → adapter, core → process, adapter → core internals", () => {
  const root = mkdtempSync(join(tmpdir(), "bounds-"));
  mkdirSync(join(root, "src/core/x"), { recursive: true });
  mkdirSync(join(root, "src/mcp"), { recursive: true });
  writeFileSync(
    join(root, "src/core/x/a.ts"),
    `import { y } from "../../mcp/y.js";\nconst p = process.env.X;\nimport proc from "node:process";\n`,
  );
  writeFileSync(join(root, "src/core/index.ts"), `export {};\n`);
  writeFileSync(
    join(root, "src/mcp/y.ts"),
    `import { z } from "../core/x/a.js";\nimport { ok } from "../core/index.js";\n`,
  );
  const msgs = checkBoundaries(root).map((v) => v.message);
  assert.ok(msgs.some((m) => m.includes("core imports adapter mcp/y.js")));
  assert.ok(msgs.some((m) => m.includes("process.env")));
  assert.ok(msgs.some((m) => m.includes("node:process")));
  assert.ok(msgs.some((m) => m.includes("via core/index.js")));
  assert.equal(msgs.length, 4);
});

test("checker catches core → provider (outside wiring), provider → core/index, adapter → provider", () => {
  const root = mkdtempSync(join(tmpdir(), "bounds-"));
  for (const d of ["src/core", "src/providers/x", "src/cli"])
    mkdirSync(join(root, d), { recursive: true });
  writeFileSync(join(root, "src/core/index.ts"), `export {};\n`);
  writeFileSync(join(root, "src/core/wiring.ts"), `import { x } from "../providers/x/index.js";\n`);
  writeFileSync(join(root, "src/core/other.ts"), `import { x } from "../providers/x/index.js";\n`);
  writeFileSync(
    join(root, "src/providers/x/index.ts"),
    `import { a } from "../../core/index.js";\nimport { w } from "../../core/wiring.js";\nimport { t } from "../../core/portal/types.js";\nimport { c } from "../../cli/program.js";\n`,
  );
  writeFileSync(join(root, "src/cli/a.ts"), `import { x } from "../providers/x/index.js";\n`);
  const msgs = checkBoundaries(root).map((v) => `${v.file}: ${v.message}`);
  assert.ok(msgs.some((m) => m.startsWith("core/other.ts: core imports a provider")));
  assert.ok(!msgs.some((m) => m.startsWith("core/wiring.ts")), "wiring may import providers");
  assert.ok(msgs.some((m) => m.includes("not core/index.js (cycle)")));
  assert.ok(msgs.some((m) => m.includes("not core/wiring.js (cycle)")));
  assert.ok(msgs.some((m) => m.includes("provider imports adapter cli/program.js")));
  assert.ok(msgs.some((m) => m.includes("adapter cli imports a provider")));
  assert.equal(msgs.length, 5);
});

test("the typed client imports only zod and its own files, and nothing imports it", () => {
  const root = mkdtempSync(join(tmpdir(), "bounds-"));
  for (const d of ["src/client", "src/http", "src/core"])
    mkdirSync(join(root, d), { recursive: true });
  writeFileSync(join(root, "src/core/index.ts"), `export {};\n`);
  writeFileSync(
    join(root, "src/client/index.ts"),
    [
      `import { z } from "zod";`,
      `import {\n  SCHEMAS,\n} from "./api.gen.js";`,
      `import type { Overview } from "../http/overview.js";`,
      `export { ok } from "../core/index.js";`,
      `import "node:fs";`,
      `const lazy = () => import("express");`,
      `const f = globalThis.fetch;`,
    ].join("\n"),
  );
  writeFileSync(join(root, "src/client/api.gen.ts"), `export const SCHEMAS = {};\n`);
  writeFileSync(
    join(root, "src/http/a.ts"),
    `import { createClient } from "../client/index.js";\n`,
  );
  const msgs = checkBoundaries(root).map((v) => `${v.file}:${v.line}: ${v.message}`);
  assert.deepEqual(msgs, [
    "client/index.ts:5: the typed client may import only zod and its own files, not ../http/overview.js",
    "client/index.ts:6: the typed client may import only zod and its own files, not ../core/index.js",
    "client/index.ts:7: the typed client may import only zod and its own files, not node:fs",
    "client/index.ts:8: the typed client may import only zod and its own files, not express",
    "http/a.ts:1: client/index.js is the typed client; nothing in the package imports it",
  ]);
});
