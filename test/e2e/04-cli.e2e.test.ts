/**
 * 04 — The CLI surface against real SchoolSoft, spawned the way a skill
 * script would. Uses the session seeded by suite 01. Asserts exit codes
 * and JSON shapes only; never prints the payloads.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { skip, record } from "./helpers.js";

const bin = join(process.cwd(), "dist", "cli", "index.js");
function run(...args: string[]) {
  const r = spawnSync(process.execPath, [bin, ...args], { encoding: "utf8", env: process.env });
  return { code: r.status, out: r.stdout, err: r.stderr, json: () => JSON.parse(r.stdout) };
}

test("C1: auth-status → authenticated, exit 0", { skip }, () => {
  const r = run("auth-status");
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json().authenticated, true);
});

test("C2: list-children, get-schedule, get-messages via the CLI", { skip }, () => {
  const kids = run("list-children");
  assert.equal(kids.code, 0, kids.err);
  const data = kids.json() as { children: { studentId: number }[]; childInFocus: number };
  assert.ok(data.children.length >= 1);
  const sched = run("get-schedule");
  assert.equal(sched.code, 0, sched.err);
  assert.ok(Array.isArray(sched.json().lessons));
  const msgs = run("get-messages", "--limit", "3", "--unread-only");
  assert.equal(msgs.code, 0, msgs.err);
  record(
    "C2",
    "CLI surface (children/schedule/messages)",
    `${data.children.length} children; schedule ${sched.json().lessons.length} lessons; unread ${msgs.json().messages.length}`,
  );
  const other = data.children.find((c) => c.studentId !== data.childInFocus);
  if (other) {
    const sw = run("get-lunch-menu", "--child-id", String(other.studentId));
    assert.equal(sw.code, 0, sw.err);
    assert.equal(sw.json().child.studentId, other.studentId);
  }
});

test("C3: find-school live and exit codes 1/3", { skip }, () => {
  const fs = run("find-school", "--query", "rösjö");
  assert.equal(fs.code, 0, fs.err);
  assert.equal(fs.json().schools[0].slug, "taby");
  assert.equal(run("get-schedule", "--child-id", "1").code, 1, "unknown child → 1");
  const nc = spawnSync(process.execPath, [bin, "list-children"], {
    encoding: "utf8",
    env: {
      ...process.env,
      SCHOOLSOFT_SCHOOL: "",
      SCHOOLSOFT_CONFIG_DIR: "/nonexistent-config-dir",
    },
  });
  assert.equal(nc.status, 3, "no config → 3");
});
