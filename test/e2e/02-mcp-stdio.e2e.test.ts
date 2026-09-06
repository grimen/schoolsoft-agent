/**
 * 02 — The shipped artifact over real stdio.
 *
 * Spawns `node dist/index.js` exactly as Claude Desktop would and talks
 * MCP to it. This is the only suite that tests what users actually run:
 * the built JS, the stdio framing, env-var config, and every tool's
 * real response shape from real SchoolSoft data.
 *
 * Requires: `npm run build` first, and a valid session from suite 01
 * (this suite never triggers interactive login — auth_status must
 * report authenticated via silent restore inside the subprocess).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { skip, record, LIVE } from "./helpers.js";

let client: Client;

interface ToolCallResult {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  content: { type: string; text: string }[];
}

async function call(name: string, args: Record<string, unknown> = {}): Promise<ToolCallResult> {
  return (await client.callTool({ name, arguments: args })) as ToolCallResult;
}

before(async () => {
  if (!LIVE) return;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(process.cwd(), "dist", "mcp", "index.js")],
    env: {
      ...(process.env as Record<string, string>),
    },
    stderr: "inherit",
  });
  client = new Client({ name: "e2e-stdio", version: "1.0" });
  await client.connect(transport);
});

after(async () => {
  if (client) await client.close();
});

test(
  "M0: tools/list exposes all 23 operations and find_school works without auth",
  { skip },
  async () => {
    const { tools } = await client.listTools();
    assert.equal(tools.length, 23);
    const res = await call("schoolsoft_find_school", { query: "rösjö" });
    assert.notEqual(res.isError, true, res.content[0]?.text);
    const data = res.structuredContent as { schools: { slug: string; orgId: number }[] };
    assert.equal(data.schools[0]?.slug, "taby");
    record(
      "M0",
      "find_school live (rösjö)",
      `${data.schools.length} hits, top=${data.schools[0]?.slug}/${data.schools[0]?.orgId}`,
    );
  },
);

test("M1: subprocess restores session silently (no BankID)", { skip }, async () => {
  const res = await call("schoolsoft_auth_status");
  const data = res.structuredContent as { authenticated: boolean; authMethod?: string };
  assert.equal(
    data.authenticated,
    true,
    "subprocess must restore the session saved by suite 01 — run 01 first",
  );
  record("M1", "Cold subprocess silent restore", `OK via ${data.authMethod}`);
});

test("M2: get_schedule returns real lessons", { skip }, async () => {
  const res = await call("schoolsoft_get_schedule");
  assert.notEqual(res.isError, true, res.content[0]?.text);
  const data = res.structuredContent as { week: number; lessons: unknown[] };
  assert.ok(typeof data.week === "number");
  assert.ok(Array.isArray(data.lessons));
  record("M2", "Schedule lessons this week", String(data.lessons.length));
});

test("M3: get_lunch_menu returns a menu", { skip }, async () => {
  const res = await call("schoolsoft_get_lunch_menu");
  assert.notEqual(res.isError, true, res.content[0]?.text);
  assert.ok(res.structuredContent);
});

test("M4: get_assignments returns an array", { skip }, async () => {
  const res = await call("schoolsoft_get_assignments");
  assert.notEqual(res.isError, true, res.content[0]?.text);
  const data = res.structuredContent as { assignments: { id?: number }[] };
  assert.ok(Array.isArray(data.assignments));
  record("M4", "Assignments this week", String(data.assignments.length));

  // Chain into detail if anything exists — validates id plumbing.
  const first = data.assignments[0];
  if (first?.id) {
    const detail = await call("schoolsoft_get_assignment_detail", { id: first.id });
    record("M4b", "Assignment detail by id", detail.isError ? "FAIL" : "OK");
    assert.notEqual(detail.isError, true, detail.content[0]?.text);
  }
});

test("M5: get_news returns items", { skip }, async () => {
  const res = await call("schoolsoft_get_news");
  assert.notEqual(res.isError, true, res.content[0]?.text);
});

test("M6: list_children + get_messages work for the guardian", { skip }, async () => {
  const kids = await call("schoolsoft_list_children");
  assert.notEqual(kids.isError, true, kids.content[0]?.text);
  const data = kids.structuredContent as {
    children: { studentId: number }[];
    childInFocus: number;
  };
  assert.ok(data.children.length >= 1);
  record(
    "Q3",
    "Multi-child accounts",
    `${data.children.length} children, focus=${data.childInFocus}`,
  );

  const msgs = await call("schoolsoft_get_messages", { limit: 5 });
  assert.notEqual(msgs.isError, true, msgs.content[0]?.text);
  const list = (msgs.structuredContent as { messages: { id: number }[] }).messages;
  record("M6", "Inbox messages (limit 5)", String(list.length));
  if (list[0]?.id) {
    const one = await call("schoolsoft_get_message", { id: list[0].id });
    assert.notEqual(one.isError, true, one.content[0]?.text);
  }
  // Switch to the other child if there is one — exercises the cookie re-bind.
  const other = data.children.find((c) => c.studentId !== data.childInFocus);
  if (other) {
    const sched = await call("schoolsoft_get_schedule", { child_id: other.studentId });
    assert.notEqual(sched.isError, true, sched.content[0]?.text);
  }
});

test("M7: response sizes stay under the character limit", { skip }, async () => {
  // Guards against context-flooding: every tool's text payload must be
  // bounded (truncation kicks in at CHARACTER_LIMIT).
  for (const name of [
    "schoolsoft_get_schedule",
    "schoolsoft_get_lunch_menu",
    "schoolsoft_get_assignments",
    "schoolsoft_get_news",
    "schoolsoft_get_messages",
    "schoolsoft_list_children",
  ]) {
    const res = await call(name);
    const len = res.content[0]?.text.length ?? 0;
    assert.ok(len <= 26_000, `${name} returned ${len} chars`);
  }
});
