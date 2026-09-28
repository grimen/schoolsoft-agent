import { test } from "node:test";
import assert from "node:assert/strict";
import { redactHome } from "../../src/shared/redact-home.js";

test("redactHome replaces every occurrence of the home directory, in either slash style", () => {
  assert.equal(
    redactHome("ENOENT: /Users/parent/.schoolsoft-agent/session.enc not found", "/Users/parent"),
    "ENOENT: ~/.schoolsoft-agent/session.enc not found",
  );
  assert.equal(
    redactHome(
      "at /Users/parent/app/index.js:1:1\n  from /Users/parent/app/lib.js:2:2",
      "/Users/parent",
    ),
    "at ~/app/index.js:1:1\n  from ~/app/lib.js:2:2",
  );
  // A Windows-style path in the message still matches a POSIX-style home, and vice versa.
  assert.equal(
    redactHome("C:\\Users\\parent\\config.json missing", "C:/Users/parent"),
    "~\\config.json missing",
  );
});

test("redactHome leaves a message without the home directory, or an empty home, untouched", () => {
  assert.equal(redactHome("no path here", "/Users/parent"), "no path here");
  assert.equal(redactHome("/Users/parent/session.enc", ""), "/Users/parent/session.enc");
});
