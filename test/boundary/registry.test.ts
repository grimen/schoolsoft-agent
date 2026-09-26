import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  operations,
  getOperation,
  runOperation,
  isVerifiable,
  VERIFY_EXCLUSIONS,
  CAPABILITIES,
  type OperationContext,
} from "../../src/core/index.js";
import { ResponseDriftError } from "../../src/core/errors/index.js";
import { BROWSER_CAPABILITIES } from "../../src/providers/schoolsoft/routing.js";

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

test("each operation declares exactly the portal capabilities its source uses; together they cover every capability", () => {
  const dir = join(process.cwd(), "src/core/operations");
  const declared = new Set<string>();
  for (const op of operations) {
    const file = join(dir, op.name.replace(/_/g, "-") + ".ts");
    const src = readFileSync(file, "utf8");
    const used = [
      ...new Set([...src.matchAll(/ctx\.portal\.([a-zA-Z]+)\(/g)].map((m) => m[1])),
    ].sort();
    assert.deepEqual(
      [...op.portal].sort(),
      used,
      `${op.name}: declared portal capabilities vs. source`,
    );
    for (const c of op.portal) declared.add(c);
  }
  const all = [...CAPABILITIES].sort();
  const unused = all.filter((c) => !declared.has(c));
  assert.deepEqual(
    unused,
    ["getNextCalendarEvent", "getParent", "getSession"],
    "capabilities without an operation are the auth-time ones",
  );
});

test("registry lookups", () => {
  assert.equal(getOperation("get_schedule")?.title, "Get schedule");
  assert.equal(getOperation("nope"), undefined);
  assert.equal(operations.length, 25);
});

test("every operation that declares an output schema is validated by runOperation", async () => {
  const typed = operations.filter((op) => op.output);
  assert.deepEqual(
    typed.map((op) => op.name),
    ["list_children", "get_schedule", "get_calendar", "get_lunch_menu", "get_messages"],
  );
  const ctx = {} as OperationContext;
  for (const op of typed) {
    assert.ok(op.output instanceof z.ZodObject, `${op.name}: MCP needs an object output schema`);
    const broken = { ...op, run: async () => ({ unexpected: true }) };
    await assert.rejects(
      runOperation(broken, ctx, {}),
      (e: unknown) =>
        e instanceof ResponseDriftError && e.operation === op.name && e.where === op.name,
      op.name,
    );
  }
  const untyped = operations.find((op) => !op.output)!;
  const raw = { anything: [1, "two"] };
  assert.equal(await runOperation({ ...untyped, run: async () => raw }, ctx, {}), raw);
});

test("doctor --verify can call every typed read operation with safe defaults, or it is excluded with a reason", () => {
  const verifiable = operations.filter(isVerifiable);
  assert.ok(verifiable.length >= 5, "the five typed reads at least");
  for (const op of verifiable) {
    const reason = VERIFY_EXCLUSIONS[op.name];
    if (reason !== undefined) {
      assert.ok(reason.trim().length > 0, `${op.name}: an exclusion needs a reason`);
      continue;
    }
    // The engine passes {} plus fresh: true where declared (and child_id only with --all-children).
    const args = "fresh" in op.input ? { fresh: true } : {};
    assert.ok(
      z.object(op.input).safeParse(args).success,
      `${op.name} needs an input doctor --verify cannot choose safely: give it a default or add it to VERIFY_EXCLUSIONS with a reason`,
    );
  }
  for (const name of Object.keys(VERIFY_EXCLUSIONS))
    assert.ok(
      verifiable.some((op) => op.name === name),
      `VERIFY_EXCLUSIONS names ${name}, which is not a verifiable operation`,
    );
  for (const op of operations.filter((o) => !o.annotations.readOnly || o.annotations.destructive))
    assert.ok(!isVerifiable(op), `${op.name} writes and must never be verified`);
});

test("runOperation returns the parsed result: undeclared keys never leave a typed operation", async () => {
  const op = getOperation("get_messages")!;
  const result = await runOperation(
    { ...op, run: async () => ({ messages: [], vendorExtra: "raw" }) },
    {} as OperationContext,
    {},
  );
  assert.deepEqual(result, { messages: [] });
});
