/**
 * Shared adapter bootstrap: config precedence from env/file/overrides, a
 * corrupt config file is an actionable error, loadContext memoises one
 * production context per process and logs to stderr by default.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileSource, loadConfig, loadContext } from "../../src/shared/bootstrap.js";

test("fileSource: absent → {}, present → parsed with configDir, corrupt → error naming the file", () => {
  const dir = mkdtempSync(join(tmpdir(), "cfg-"));
  assert.deepEqual(fileSource(dir), {});
  writeFileSync(join(dir, "config.json"), JSON.stringify({ school: "taby" }));
  assert.deepEqual(fileSource(dir), { school: "taby", configDir: dir });
  writeFileSync(join(dir, "config.json"), "{oops");
  assert.throws(() => fileSource(dir), /Could not parse .*config\.json/);
});

test("loadConfig without overrides reads env + file; loadContext builds one memoised context", () => {
  const home = mkdtempSync(join(tmpdir(), "home-"));
  const dir = join(home, "cfg");
  mkdirSync(dir);
  writeFileSync(join(dir, "config.json"), JSON.stringify({ school: "taby", orgId: "20" }));
  const inputs = { env: { SCHOOLSOFT_CONFIG_DIR: dir }, home, platform: "linux" as const };
  const config = loadConfig(inputs);
  assert.equal(config.school, "taby");
  assert.equal(config.configDir, dir);
  const factory = loadContext(inputs);
  const ctx = factory();
  assert.equal(ctx.config.school, "taby");
  assert.equal(factory(), ctx, "memoised");
  const errors: string[] = [];
  const orig = console.error;
  console.error = (m: string) => errors.push(m);
  try {
    ctx.log("hello");
  } finally {
    console.error = orig;
  }
  assert.deepEqual(errors, ["hello"]);
  const logs: string[] = [];
  const custom = loadContext({ ...inputs, log: (m) => logs.push(m) })();
  custom.log("x");
  assert.deepEqual(logs, ["x"]);
});
