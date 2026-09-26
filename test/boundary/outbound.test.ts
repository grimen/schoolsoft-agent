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

test("the real tree: only the provider's net.ts calls fetch; @elias4044/ssp-node is gone", () => {
  assert.deepEqual(
    checkBoundaries(process.cwd()).filter((v) => /budget|net\.ts|inbound|ssp-node/.test(v.message)),
    [],
  );
  const src = join(process.cwd(), "src");
  const callers = walk(src)
    .filter((f) => /(^|[^\w.$])fetch\(/.test(readFileSync(f, "utf8")))
    .map((f) => relative(src, f));
  assert.deepEqual(callers, ["providers/schoolsoft/net.ts"]);
  const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as Record<
    string,
    Record<string, string> | undefined
  >;
  for (const field of ["dependencies", "devDependencies", "optionalDependencies"])
    assert.equal(pkg[field]?.["@elias4044/ssp-node"], undefined, field);
  assert.doesNotMatch(
    readFileSync(join(process.cwd(), "package-lock.json"), "utf8"),
    /@elias4044\/ssp-node/,
  );
});

test("the checker refuses every way around the budget", () => {
  const root = mkdtempSync(join(tmpdir(), "outbound-"));
  for (const d of ["src/core/auth", "src/providers/x", "src/cli", "src/http"])
    mkdirSync(join(root, d), { recursive: true });
  writeFileSync(join(root, "src/core/index.ts"), "export {};\n");
  writeFileSync(
    join(root, "src/providers/x/net.ts"),
    [
      `export const get = (u: string) => fetch(u, { redirect: "manual" });`,
      `import { schoolsoftFetch } from "@elias4044/ssp-node";`,
    ].join("\n"),
  );
  writeFileSync(
    join(root, "src/providers/x/backend.ts"),
    [
      `import {`,
      `  ssUrl,`,
      `  getNews,`,
      `} from "@elias4044/ssp-node";`,
      `import type { SchoolsoftClient } from "@elias4044/ssp-node";`,
      `export const a = () => globalThis.fetch("x");`,
      `export const b = async () => (await import("@elias4044/ssp-node")).getNews;`,
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
  const gone = "@elias4044/ssp-node is not a dependency; requests go through net.ts";
  assert.deepEqual(
    found.sort(),
    [
      "cli/doctor.ts:1: fetch is called outside the provider's budgeted transport (net.ts)",
      `providers/x/net.ts:2: ${gone}`,
      `providers/x/backend.ts:4: ${gone}`,
      `providers/x/backend.ts:5: ${gone}`,
      `providers/x/backend.ts:7: ${gone}`,
      "providers/x/backend.ts:9: https is imported outside the inbound servers; requests go through net.ts",
      "providers/x/backend.ts:6: fetch is called outside the provider's budgeted transport (net.ts)",
    ].sort(),
  );
});
