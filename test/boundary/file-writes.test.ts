/**
 * Every file and directory the tool creates goes through
 * src/core/private-files.ts (0700 directories, 0600 files): the checker's
 * file-write rule on the real tree and on synthetic violations. The
 * behavioural half (every real writer leaves only private modes) is
 * test/unit/file-modes.test.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkBoundaries } from "../../scripts/check-boundaries.js";

const rule = /creates files|node:fs is imported/;

test("the real tree: nothing but core/private-files.ts creates files", () => {
  assert.deepEqual(
    checkBoundaries(process.cwd()).filter((v) => rule.test(v.message)),
    [],
  );
});

test("the checker refuses every way to create a file around the helper", () => {
  const root = mkdtempSync(join(tmpdir(), "file-writes-"));
  for (const d of [
    "src/core/session",
    "src/providers/x/capture",
    "src/providers/schoolsoft/capture",
    "src/cli",
    "src/http",
  ])
    mkdirSync(join(root, d), { recursive: true });
  writeFileSync(join(root, "src/core/index.ts"), "export {};\n");
  // The helper itself and the fixture promotion tool may.
  writeFileSync(
    join(root, "src/core/private-files.ts"),
    `import { mkdirSync, writeFileSync } from "node:fs";\n`,
  );
  writeFileSync(
    join(root, "src/providers/schoolsoft/capture/promote.ts"),
    `import { mkdirSync, renameSync } from "node:fs";\n`,
  );
  // Reading, deleting and renaming are fine anywhere; types create nothing.
  writeFileSync(
    join(root, "src/http/reader.ts"),
    [
      `import { existsSync, readFileSync, rmSync, renameSync } from "node:fs";`,
      `import type { WriteStream } from "node:fs";`,
    ].join("\n"),
  );
  writeFileSync(
    join(root, "src/core/session/store.ts"),
    [
      `import {`,
      `  readFileSync,`,
      `  writeFileSync as write,`,
      `  mkdirSync,`,
      `} from "node:fs";`,
    ].join("\n"),
  );
  writeFileSync(
    join(root, "src/providers/x/cache.ts"),
    [
      `import { appendFile, mkdir } from "node:fs/promises";`,
      `import { createWriteStream, openSync, copyFileSync } from "fs";`,
    ].join("\n"),
  );
  writeFileSync(
    join(root, "src/cli/whole.ts"),
    [
      `import fs from "node:fs";`,
      `import * as promises from "node:fs/promises";`,
      `import fs2, { readFileSync } from "fs";`,
      `export const later = () => import("node:fs");`,
    ].join("\n"),
  );
  const found = checkBoundaries(root).map((v) => `${v.file}:${v.line}: ${v.message}`);
  const creates = (file: string, line: number, name: string) =>
    `${file}:${line}: ${name} creates files outside core/private-files.ts; use its helpers (0700 directories, 0600 files)`;
  const whole = (line: number) =>
    `cli/whole.ts:${line}: node:fs is imported as a whole; import reading functions by name and create files through core/private-files.ts`;
  assert.deepEqual(
    found.sort(),
    [
      creates("core/session/store.ts", 1, "writeFileSync"),
      creates("core/session/store.ts", 1, "mkdirSync"),
      creates("providers/x/cache.ts", 1, "appendFile"),
      creates("providers/x/cache.ts", 1, "mkdir"),
      creates("providers/x/cache.ts", 2, "createWriteStream"),
      creates("providers/x/cache.ts", 2, "openSync"),
      creates("providers/x/cache.ts", 2, "copyFileSync"),
      whole(1),
      whole(2),
      whole(3),
      "cli/whole.ts:4: node:fs is imported dynamically; create files through core/private-files.ts",
    ].sort(),
  );
});
