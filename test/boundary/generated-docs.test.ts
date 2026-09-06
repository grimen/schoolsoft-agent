import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { OUTPUTS } from "../../scripts/gen-docs.js";

for (const [rel, render] of Object.entries(OUTPUTS)) {
  test(`${rel} is up to date (run \`make docs\`)`, () => {
    const file = join(process.cwd(), rel);
    assert.ok(existsSync(file), `${rel} missing — run make docs`);
    assert.equal(readFileSync(file, "utf8"), render(), `${rel} is stale — run make docs`);
  });
}
