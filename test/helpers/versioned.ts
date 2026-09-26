/** Shared assertion for the versioned-state tests. */
import assert from "node:assert/strict";
import { EXIT_CODE_BY_KIND, NewerFormatError, describeError } from "../../src/core/index.js";

/** A newer file: the error names it, says what to do in both languages and exits 5. */
export function assertNewer(e: unknown, file: string): true {
  assert.ok(e instanceof NewerFormatError, String(e));
  assert.equal(e.kind, "not_available");
  assert.equal(EXIT_CODE_BY_KIND[e.kind], 5);
  const en = describeError(e, "en", "cli");
  assert.match(en.message, /written by a newer version of schoolsoft-agent/);
  assert.ok(en.message.includes(file), `${en.message} names ${file}`);
  assert.match(en.hint!, /Update schoolsoft-agent/);
  const sv = describeError(e, "sv", "mcp");
  assert.match(sv.message, /skrevs av en nyare version av schoolsoft-agent/);
  assert.match(sv.hint!, /uppdatera schoolsoft-agent/);
  return true;
}
