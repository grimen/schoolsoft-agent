/**
 * The offline guard (test/helpers/offline.mjs, preloaded by the test scripts):
 * no request reaches the real school portal, from this process or from a child
 * process a test spawns with the inherited environment.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import https from "node:https";

test("this process cannot reach the school portal through fetch or node:https", async () => {
  await assert.rejects(fetch("https://taby.schoolsoft.se/"), /offline test tried to reach/);
  assert.throws(() => https.get("https://sms.schoolsoft.se/"), /offline test tried to reach/);
  assert.match(process.env.NODE_OPTIONS ?? "", /offline\.mjs/);
});

test("a spawned node child inherits the guard", () => {
  const probe =
    "fetch('https://taby.schoolsoft.se/').then(() => process.exit(0), (e) => { console.log(e.message); process.exit(3); })";
  const r = spawnSync(process.execPath, ["-e", probe], { env: process.env, encoding: "utf8" });
  assert.equal(r.status, 3, r.stderr);
  assert.match(r.stdout, /offline test tried to reach the school portal \(taby\.schoolsoft\.se\)/);
});
