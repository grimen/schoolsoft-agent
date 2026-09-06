/**
 * Operations run directly against a real SessionManager with fakes —
 * the surface-independent contract every adapter relies on.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { getOperation, NotAuthenticatedError, type Operation } from "../../src/core/index.js";
import { makeContext } from "../helpers/fakes.js";

const op = (name: string) => getOperation(name) as Operation;
const run = (
  name: string,
  ctx: Parameters<Operation["run"]>[0],
  args: Record<string, unknown> = {},
) => op(name).run(ctx, args as never) as Promise<Record<string, any>>;

test("read operations before login throw NotAuthenticatedError", async () => {
  const { ctx } = makeContext();
  await assert.rejects(run("get_schedule", ctx), NotAuthenticatedError);
  const status = await run("auth_status", ctx);
  assert.equal(status.authenticated, false);
  assert.match(status.reason, /login/);
});

test("login → schedule defaults to the child in focus", async () => {
  const { ctx } = makeContext();
  const login = await run("login", ctx);
  assert.equal(login.status, "logged_in");
  const s = await run("get_schedule", ctx, { week: 35 });
  assert.equal(s.week, 35);
  assert.equal(s.child.studentId, 100);
  assert.equal(s.lessons[0].name, "Matematik");
});

test("child_id switches focus, list_children reflects it, unknown ids are rejected before any side effect", async () => {
  const { ctx, strategy } = makeContext();
  await run("login", ctx);
  const s = await run("get_schedule", ctx, { child_id: 101 });
  assert.equal(s.child.studentId, 101);
  const kids = await run("list_children", ctx);
  assert.equal(kids.children.length, 2);
  assert.equal(kids.childInFocus, 101);
  await assert.rejects(run("get_lunch_menu", ctx, { child_id: 999 }), /Unknown child id 999/);
  assert.equal(strategy.context?.childInFocus, 101, "focus unchanged after rejection");
});

test("lunch, assignments, assignment detail, news carry the child and pass ids through", async () => {
  const { ctx } = makeContext();
  await run("login", ctx);
  const lunch = await run("get_lunch_menu", ctx, { week: 37 });
  assert.equal(lunch.menu[0].week, 37);
  const a = await run("get_assignments", ctx, { week: 37, year: 2026 });
  assert.deepEqual(a.assignments, [{ id: 7, title: "Läxa" }]);
  const d = await run("get_assignment_detail", ctx, { id: 7 });
  assert.equal(d.assignment.view.id, 7);
  const n = await run("get_news", ctx, { limit: 1 });
  assert.equal(n.news.length, 1);
});

test("messages: unread filter, limit, single fetch", async () => {
  const { ctx } = makeContext();
  await run("login", ctx);
  assert.equal((await run("get_messages", ctx)).messages.length, 2);
  assert.deepEqual(
    (await run("get_messages", ctx, { unread_only: true })).messages.map((m: any) => m.id),
    [5],
  );
  assert.equal((await run("get_messages", ctx, { limit: 1 })).messages.length, 1);
  assert.equal((await run("get_message", ctx, { id: 5 })).message.message, "Full text");
});

test("auth_status after login reports children; logout invalidates", async () => {
  const { ctx } = makeContext();
  await run("login", ctx);
  const st = await run("auth_status", ctx);
  assert.equal(st.authenticated, true);
  assert.equal(st.school, "testskola");
  assert.equal(st.children.length, 2);
  assert.deepEqual(await run("logout", ctx), { status: "logged_out" });
  await assert.rejects(run("get_news", ctx), NotAuthenticatedError);
});

test("find_school works without a session and uses the config dir cache", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { writeFileSync } = await import("node:fs");
  const configDir = mkdtempSync(join(tmpdir(), "cfg-"));
  writeFileSync(
    join(configDir, "schools.json"),
    JSON.stringify({
      fetchedAt: Date.now(),
      schools: [{ name: "Täby kommun - Rösjöskolan", slug: "taby", orgId: 20 }],
    }),
  );
  const { ctx } = makeContext({ config: { configDir } });
  const r = await run("find_school", ctx, { query: "rösjö" });
  assert.equal(r.schools[0].slug, "taby");
  assert.equal(op("find_school").annotations.requiresAuth, false);
});

test("browser-backed and web-gated operations return the child plus the portal page", async () => {
  const { ctx } = makeContext();
  await run("login", ctx);
  for (const [name, key] of [
    ["get_subject_rooms", "subjects"],
    ["get_bookings", "bookings"],
    ["get_files", "files"],
    ["get_grades", "page"],
    ["get_student_documents", "page"],
    ["get_unreported_absence", "page"],
    ["get_attendance_report", "page"],
    ["get_grade_prognosis", "reconciliationDates"],
  ] as const) {
    const r = await run(name, ctx);
    assert.ok(r.child, `${name} names the child`);
    assert.ok(key in r, `${name} returns ${key}: ${Object.keys(r)}`);
  }
  const crit = await run("get_assessment_criteria", ctx, { subject_id: 1301 });
  assert.equal(crit.page.title, "Kriterier 1301");
});
