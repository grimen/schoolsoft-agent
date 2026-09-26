/**
 * The host probe never ships: the build leaves it out (so it is in neither the npm
 * package nor the connector image), nothing that ships imports it, and it has no bin.
 * `scripts/pack-smoke.sh` checks the packed tarball itself.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) => readFileSync(path, "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (path.endsWith(".ts")) out.push(path);
  }
  return out;
}

test("the build excludes the probe, and the typecheck still covers it", () => {
  const build = JSON.parse(read("tsconfig.json")) as { include: string[]; exclude: string[] };
  assert.deepEqual(build.exclude, ["src/http/probe"]);
  const typecheck = JSON.parse(read("tsconfig.test.json")) as { exclude: string[] };
  assert.deepEqual(typecheck.exclude, []);
});

test("no shipped source imports the probe", () => {
  const importers = walk("src")
    .filter((path) => !path.startsWith(join("src", "http", "probe")))
    .filter((path) => /from\s+["'][^"']*\/probe\/[^"']*["']/.test(read(path)));
  assert.deepEqual(importers, []);
});

test("the probe has no bin, is started only by its make targets, and keeps its log out of git", () => {
  const pkg = JSON.parse(read("package.json")) as { bin: Record<string, string> };
  assert.ok(Object.values(pkg.bin).every((bin) => !bin.includes("probe")));
  const makefile = read("Makefile");
  assert.match(makefile, /^host-probe: .*\n\t\$\(TSX\) src\/http\/probe\/cli\.ts http$/m);
  assert.match(makefile, /^host-probe-stdio: .*\n\t\$\(TSX\) src\/http\/probe\/cli\.ts stdio$/m);
  assert.match(read(".gitignore"), /^\.host-probe\/$/m);
  assert.match(read("scripts/pack-smoke.sh"), /http\/probe/);
});
