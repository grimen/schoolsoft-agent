/** MCP response formatting: truncation over the character limit, error text and hints. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ok, fail } from "../../src/mcp/respond.js";
import { CHARACTER_LIMIT, NotAuthenticatedError } from "../../src/core/index.js";

test("ok(): structured content under the limit, truncated text (no structured content) above it", () => {
  const small = ok({ a: 1 });
  assert.deepEqual(small.structuredContent, { a: 1 });
  const big = ok({ blob: "x".repeat(CHARACTER_LIMIT + 10) });
  assert.equal(big.structuredContent, undefined);
  assert.match(big.content[0].text, /truncated at \d+ chars/);
  assert.ok(big.content[0].text.length < CHARACTER_LIMIT + 200);
});

test("fail(): message from Error, string or nothing; auth errors carry no extra hint", () => {
  assert.match(
    fail(new Error("boom")).content[0].text,
    /^Error: boom\nIf this looks like an auth problem/,
  );
  assert.match(fail("plain").content[0].text, /^Error: plain/);
  assert.match(fail(undefined).content[0].text, /^Error: Unknown error/);
  const auth = fail(new NotAuthenticatedError("x"));
  assert.doesNotMatch(auth.content[0].text, /auth_status/);
  assert.equal(auth.isError, true);
});
