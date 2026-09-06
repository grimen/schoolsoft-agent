import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { flagsFromSchema, parseFlags, kebab, camel } from "../../src/cli/flags.js";

test("derives flags for number, string, boolean, enum with optionality and descriptions", () => {
  const specs = flagsFromSchema({
    week: z.number().int().optional().describe("ISO week"),
    child_id: z.number().int().optional(),
    query: z.string().min(2).describe("Name"),
    unread_only: z.boolean().optional().describe("Only unread"),
    type: z.enum(["assignment", "planning"]).optional(),
  });
  assert.deepEqual(
    specs.map((s) => [s.flag, s.kind, s.required]),
    [
      ["--week <number>", "number", false],
      ["--child-id <number>", "number", false],
      ["--query <value>", "string", true],
      ["--unread-only", "boolean", false],
      ["--type <choice>", "enum", false],
    ],
  );
  assert.equal(specs[0].description, "ISO week");
  assert.equal(specs[1].optionName, "childId");
  assert.deepEqual(specs[4].choices, ["assignment", "planning"]);
});

test("unsupported schema types fail at build time", () => {
  assert.throws(
    () => flagsFromSchema({ ids: z.array(z.number()) }),
    /Unsupported input schema for "ids"/,
  );
});

test("parseFlags converts commander options back to typed snake_case args", () => {
  const specs = flagsFromSchema({
    week: z.number().optional(),
    child_id: z.number().optional(),
    unread_only: z.boolean().optional(),
    type: z.enum(["a", "b"]).optional(),
    query: z.string(),
  });
  assert.deepEqual(
    parseFlags(specs, { week: "37", childId: "101", unreadOnly: true, type: "a", query: "x" }),
    {
      week: 37,
      child_id: 101,
      unread_only: true,
      type: "a",
      query: "x",
    },
  );
  assert.deepEqual(parseFlags(specs, { query: "x" }), { query: "x" });
  assert.throws(() => parseFlags(specs, { week: "abc" }), /--week must be a number/);
  assert.throws(() => parseFlags(specs, { type: "zzz" }), /--type must be one of a, b/);
});

test("kebab/camel helpers", () => {
  assert.equal(kebab("child_id"), "child-id");
  assert.equal(camel("child_id"), "childId");
  assert.equal(camel("unread-only"), "unreadOnly");
});
