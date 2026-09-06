/**
 * Spawns the built CLI binary once, the way a skill script would. Requires
 * `npm run build` first (the boundary of "shipped artifact" testing).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const bin = join(process.cwd(), "dist", "cli", "index.js");
const skip = existsSync(bin) ? false : "run `npm run build` first";

test("built CLI: --help exits 0, find-school works offline from a cached list, exit 3 when unconfigured", { skip }, () => {
  const cfg = mkdtempSync(join(tmpdir(), "cfg-"));
  writeFileSync(join(cfg, "schools.json"), JSON.stringify({ fetchedAt: Date.now(), schools: [{ name: "Täby kommun - Rösjöskolan", slug: "taby", orgId: 20 }] }));
  const env = { ...process.env, SCHOOLSOFT_CONFIG_DIR: cfg, SCHOOLSOFT_SCHOOL: "" };

  const help = spawnSync(process.execPath, [bin, "--help"], { env, encoding: "utf8" });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /find-school/);

  const nc = spawnSync(process.execPath, [bin, "list-children"], { env, encoding: "utf8" });
  assert.equal(nc.status, 3, nc.stderr);

  const fs = spawnSync(process.execPath, [bin, "--school", "taby", "find-school", "--query", "rösjö"], { env, encoding: "utf8" });
  assert.equal(fs.status, 0, fs.stderr);
  assert.equal(JSON.parse(fs.stdout).schools[0].orgId, 20);
});
