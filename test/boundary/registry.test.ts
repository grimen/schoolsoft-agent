import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { operations, getOperation, BROWSER_CAPABILITIES } from "../../src/core/index.js";

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
  const noAuth = operations
    .filter((o) => !o.annotations.requiresAuth)
    .map((o) => o.name)
    .sort();
  assert.deepEqual(noAuth, ["auth_status", "find_school", "login", "logout"]);
});

test("input keys are snake_case and every field is a supported Zod type", () => {
  const supported = (s: z.ZodTypeAny): boolean => {
    const t = s instanceof z.ZodOptional ? s.unwrap() : s;
    return (
      t instanceof z.ZodNumber ||
      t instanceof z.ZodString ||
      t instanceof z.ZodBoolean ||
      t instanceof z.ZodEnum
    );
  };
  for (const op of operations) {
    for (const [k, v] of Object.entries(op.input)) {
      assert.match(k, /^[a-z]+(_[a-z]+)*$/, `${op.name}.${k}`);
      assert.ok(supported(v as z.ZodTypeAny), `${op.name}.${k} has an unsupported schema type`);
    }
  }
});

test("every browser capability is used by an operation whose description says how to install the browser", () => {
  const src = (name: string) =>
    readFileSync(join(process.cwd(), "src/core/operations", name), "utf8");
  for (const [op, file] of [
    ["get_contacts", "get-contacts.ts"],
    ["get_bookings", "get-bookings.ts"],
    ["get_files", "get-files.ts"],
  ]) {
    assert.match(getOperation(op)?.description ?? "", /browser install/, op);
    assert.match(src(file), /ctx\.portal\.get/, file);
  }
  for (const cap of BROWSER_CAPABILITIES) {
    const used = readdirSync(join(process.cwd(), "src/core/operations")).some(
      (f) => f.endsWith(".ts") && src(f).includes(`ctx.portal.${cap}(`),
    );
    assert.ok(used, `browser capability ${cap} is not used by any operation`);
  }
});

test("every web-session capability's operation says how to get the web login", () => {
  for (const op of [
    "get_grades",
    "get_student_documents",
    "get_unreported_absence",
    "get_attendance_report",
    "get_assessment_criteria",
    "get_grade_prognosis",
  ]) {
    assert.match(getOperation(op)?.description ?? "", /login --web/, op);
  }
});

test("registry lookups", () => {
  assert.equal(getOperation("get_schedule")?.title, "Get schedule");
  assert.equal(getOperation("nope"), undefined);
  assert.equal(operations.length, 23);
});
