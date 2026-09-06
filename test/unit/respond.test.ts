/** MCP response formatting: truncation over the character limit, error text and hints. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ok, fail } from "../../src/mcp/respond.js";
import {
  CHARACTER_LIMIT,
  CapabilityNotSupportedError,
  NotAuthenticatedError,
} from "../../src/core/index.js";

test("ok(): structured content under the limit, truncated text (no structured content) above it", () => {
  const small = ok({ a: 1 });
  assert.deepEqual(small.structuredContent, { a: 1 });
  const big = ok({ blob: "x".repeat(CHARACTER_LIMIT + 10) });
  assert.equal(big.structuredContent, undefined);
  assert.match(big.content[0].text, /truncated at \d+ chars/);
  assert.ok(big.content[0].text.length < CHARACTER_LIMIT + 200);
});

test("fail(): problem line + next step, structured kind, both languages; bugs are called bugs", () => {
  const bug = fail(new Error("boom"));
  assert.match(bug.content[0].text, /^Error: Unexpected error: boom\nNext: This looks like a bug/);
  assert.deepEqual(
    (bug.structuredContent as { error: { kind: string; retryable: boolean } }).error.kind,
    "internal",
  );
  assert.match(fail("plain").content[0].text, /Unexpected error: plain/);
  assert.match(fail(undefined).content[0].text, /Unexpected error: undefined/);
  const auth = fail(new NotAuthenticatedError("x"));
  assert.match(
    auth.content[0].text,
    /^Error: Not logged in to SchoolSoft \(x\)\.\nNext: Call schoolsoft_login/,
  );
  assert.equal(auth.isError, true);
  const sv = fail(new NotAuthenticatedError("x"), "sv");
  assert.match(
    sv.content[0].text,
    /Inte inloggad på SchoolSoft \(x\)\.\nNext: Anropa schoolsoft_login/,
  );
  const noHint = fail(new CapabilityNotSupportedError("getGrades", "x"));
  assert.doesNotMatch(noHint.content[0].text, /Next:/);
});
