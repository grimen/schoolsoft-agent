import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { operations, getOperation } from "../../src/core/index.js";

test("operation names are unique snake_case", () => {
  const names = operations.map((o) => o.name);
  assert.equal(new Set(names).size, names.length);
  for (const n of names) assert.match(n, /^[a-z]+(_[a-z]+)*$/);
});

test("every operation has title, 'Use when:' guidance and complete annotations", () => {
  for (const op of operations) {
    assert.ok(op.title.length > 0, op.name);
    assert.match(op.description, /Use when:/, `${op.name} lacks "Use when:"`);
    for (const k of ["readOnly", "destructive", "idempotent", "requiresAuth"] as const) {
      assert.equal(typeof op.annotations[k], "boolean", `${op.name}.${k}`);
    }
  }
});

test("only find_school, auth_status, login and logout skip the auth requirement", () => {
  const noAuth = operations.filter((o) => !o.annotations.requiresAuth).map((o) => o.name).sort();
  assert.deepEqual(noAuth, ["auth_status", "find_school", "login", "logout"]);
});

test("input keys are snake_case and every field is a supported Zod type", () => {
  const supported = (s: z.ZodTypeAny): boolean => {
    const t = s instanceof z.ZodOptional ? s.unwrap() : s;
    return t instanceof z.ZodNumber || t instanceof z.ZodString || t instanceof z.ZodBoolean || t instanceof z.ZodEnum;
  };
  for (const op of operations) {
    for (const [k, v] of Object.entries(op.input)) {
      assert.match(k, /^[a-z]+(_[a-z]+)*$/, `${op.name}.${k}`);
      assert.ok(supported(v as z.ZodTypeAny), `${op.name}.${k} has an unsupported schema type`);
    }
  }
});

test("registry lookups", () => {
  assert.equal(getOperation("get_schedule")?.title, "Get schedule");
  assert.equal(getOperation("nope"), undefined);
  assert.equal(operations.length, 12);
});
