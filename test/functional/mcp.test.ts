/**
 * Functional: a real MCP Client talks to the registry-driven McpServer over
 * InMemoryTransport. SchoolSoft is a fake GuardianApi; auth is a fake
 * strategy (BankID cannot appear in automated tests).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer, TOOL_PREFIX } from "../../src/mcp/server.js";
import { operations, NotConfiguredError, type LoginInfo } from "../../src/core/index.js";
import { makeContext, FAKE_LESSONS } from "../helpers/fakes.js";

let client: Client;
let harness: ReturnType<typeof makeContext>;

before(async () => {
  harness = makeContext();
  const server = createMcpServer({ getContext: () => harness.ctx, version: "test" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "functional-test", version: "1.0" });
  await Promise.all([server.connect(st), client.connect(ct)]);
});

after(async () => {
  await client.close();
});

const text = (res: unknown) => ((res as { content: { text: string }[] }).content[0]?.text) ?? "";

test("tools/list exposes one prefixed tool per operation with mirrored annotations", async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map((t) => t.name).sort(),
    operations.map((o) => TOOL_PREFIX + o.name).sort(),
  );
  const sched = tools.find((t) => t.name === "schoolsoft_get_schedule")!;
  assert.equal(sched.annotations?.readOnlyHint, true);
  assert.equal(sched.annotations?.destructiveHint, false);
  const logout = tools.find((t) => t.name === "schoolsoft_logout")!;
  assert.equal(logout.annotations?.destructiveHint, true);
  assert.match(sched.description ?? "", /Use when:/);
});

test("read tool before login returns an actionable not-authenticated error", async () => {
  const res = await client.callTool({ name: "schoolsoft_get_schedule", arguments: {} });
  assert.equal(res.isError, true);
  assert.match(text(res), /schoolsoft_login/);
});

test("auth_status reports unauthenticated without prompting", async () => {
  const res = await client.callTool({ name: "schoolsoft_auth_status", arguments: {} });
  assert.equal(res.isError, undefined);
  assert.equal((res.structuredContent as { authenticated: boolean }).authenticated, false);
});

test("login → schedule → structured content, child switch, messages", async () => {
  const login = await client.callTool({ name: "schoolsoft_login", arguments: {} });
  const loginData = login.structuredContent as { status: string; user: LoginInfo };
  assert.equal(loginData.status, "logged_in");
  assert.equal(loginData.user.name, "Test Testsson");

  const res = await client.callTool({ name: "schoolsoft_get_schedule", arguments: { week: 35 } });
  const data = res.structuredContent as { week: number; lessons: typeof FAKE_LESSONS; child: { studentId: number } };
  assert.equal(data.week, 35);
  assert.equal(data.lessons.length, 2);
  assert.equal(data.child.studentId, 100);

  const sw = await client.callTool({ name: "schoolsoft_get_schedule", arguments: { child_id: 101 } });
  assert.equal((sw.structuredContent as { child: { studentId: number } }).child.studentId, 101);
  const bad = await client.callTool({ name: "schoolsoft_get_schedule", arguments: { child_id: 999 } });
  assert.equal(bad.isError, true);
  assert.match(text(bad), /Unknown child id 999/);

  const unread = await client.callTool({ name: "schoolsoft_get_messages", arguments: { unread_only: true } });
  assert.deepEqual((unread.structuredContent as { messages: { id: number }[] }).messages.map((m) => m.id), [5]);
});

test("Zod validation rejects out-of-range week", async () => {
  const res = await client.callTool({ name: "schoolsoft_get_schedule", arguments: { week: 99 } });
  assert.equal(res.isError, true);
});

test("logout invalidates the session for subsequent calls", async () => {
  await client.callTool({ name: "schoolsoft_logout", arguments: {} });
  const res = await client.callTool({ name: "schoolsoft_get_news", arguments: {} });
  assert.equal(res.isError, true);
});

test("a NotConfiguredError from the context factory surfaces per call, server still up", async () => {
  const server = createMcpServer({ getContext: () => { throw new NotConfiguredError("no school slug"); } });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: "t", version: "1" });
  await Promise.all([server.connect(st), c.connect(ct)]);
  const res = await c.callTool({ name: "schoolsoft_find_school", arguments: { query: "täby" } });
  assert.equal(res.isError, true);
  assert.match(text(res), /schoolsoft-agent configure/);
  await c.close();
});
