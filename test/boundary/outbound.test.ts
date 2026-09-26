/**
 * No code path reaches the school portal around the request budget: the
 * import checker's outbound rules on the real tree and on synthetic
 * violations. The behavioural half (every upstream call of the production
 * wiring passes the budget) is test/unit/request-budget-wiring.test.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { checkBoundaries } from "../../scripts/check-boundaries.js";

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

test("the real tree: only the provider's net.ts imports the HTTP helper or calls fetch; nothing uses ssp-node's own requests", () => {
  assert.deepEqual(
    checkBoundaries(process.cwd()).filter((v) => /budget|net\.ts|inbound/.test(v.message)),
    [],
  );
  const src = join(process.cwd(), "src");
  const importers = walk(src)
    .filter((f) =>
      /import\s*\{[^}]*\bschoolsoftFetch\b[^}]*\}\s*from/.test(readFileSync(f, "utf8")),
    )
    .map((f) => relative(src, f));
  assert.deepEqual(importers, ["providers/schoolsoft/net.ts"]);
});

test("the checker refuses every way around the budget", () => {
  const root = mkdtempSync(join(tmpdir(), "outbound-"));
  for (const d of ["src/core/auth", "src/providers/x", "src/cli", "src/http"])
    mkdirSync(join(root, d), { recursive: true });
  writeFileSync(join(root, "src/core/index.ts"), "export {};\n");
  writeFileSync(
    join(root, "src/providers/x/net.ts"),
    [
      `import { schoolsoftFetch } from "@elias4044/ssp-node";`,
      `export const get = (u: string) => fetch(u);`,
    ].join("\n"),
  );
  writeFileSync(
    join(root, "src/providers/x/backend.ts"),
    [
      `import {`,
      `  ssUrl,`,
      `  schoolsoftFetch,`,
      `  rawRequest as raw,`,
      `  getNews,`,
      `} from "@elias4044/ssp-node";`,
      `import type { SchoolsoftClient } from "@elias4044/ssp-node";`,
      `export const a = () => globalThis.fetch("x");`,
      `export const b = (client: SchoolsoftClient) => client.getSchedule(1);`,
      `export const c = (s: { verifySession(): void }) => s.verifySession();`,
      `// a comment about a fetch (not a call) and this.fetchImpl(x) are fine`,
      `import { request } from "node:https";`,
    ].join("\n"),
  );
  writeFileSync(join(root, "src/cli/doctor.ts"), `export const p = () => fetch("https://x/");\n`);
  writeFileSync(
    join(root, "src/core/auth/callback-server.ts"),
    `import { createServer } from "node:http";\n`,
  );
  writeFileSync(join(root, "src/http/server.ts"), `import { createServer } from "node:http";\n`);
  const found = checkBoundaries(root).map((v) => `${v.file}:${v.line}: ${v.message}`);
  assert.deepEqual(
    found.sort(),
    [
      "cli/doctor.ts:1: fetch is called outside the provider's budgeted transport (net.ts)",
      "providers/x/backend.ts:1: rawRequest is imported outside the provider's budgeted transport (net.ts)",
      "providers/x/backend.ts:1: schoolsoftFetch is imported outside the provider's budgeted transport (net.ts)",
      "providers/x/backend.ts:1: ssp-node's getNews sends requests around the request budget",
      "providers/x/backend.ts:12: https is imported outside the inbound servers; requests go through net.ts",
      "providers/x/backend.ts:8: fetch is called outside the provider's budgeted transport (net.ts)",
      "providers/x/backend.ts:9: SchoolsoftClient.getSchedule sends requests around the request budget",
      "providers/x/backend.ts:10: verifySession sends requests around the request budget",
    ].sort(),
  );
});
