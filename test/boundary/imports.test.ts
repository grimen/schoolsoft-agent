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
  writeFileSync(join(root, "src/core/x/a.ts"), `import { y } from "../../mcp/y.js";\nconst p = process.env.X;\nimport proc from "node:process";\n`);
  writeFileSync(join(root, "src/core/index.ts"), `export {};\n`);
  writeFileSync(join(root, "src/mcp/y.ts"), `import { z } from "../core/x/a.js";\nimport { ok } from "../core/index.js";\n`);
  const msgs = checkBoundaries(root).map((v) => v.message);
  assert.ok(msgs.some((m) => m.includes("core imports adapter mcp/y.js")));
  assert.ok(msgs.some((m) => m.includes("process.env")));
  assert.ok(msgs.some((m) => m.includes("node:process")));
  assert.ok(msgs.some((m) => m.includes("via core/index.js")));
  assert.equal(msgs.length, 4);
});
