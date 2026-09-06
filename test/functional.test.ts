/**
 * Functional tests: a real MCP Client talks to the real McpServer over
 * InMemoryTransport. Everything is exercised except SchoolSoft itself —
 * the SchoolsoftClient is a fake injected through SessionManager, and
 * the auth strategy is a fake (BankID cannot appear in automated tests).
 *
 * This verifies: tool registration, Zod input validation, the
 * ensureSession guard, structuredContent output, and error surfacing.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { SchoolsoftClient } from "@elias4044/ssp-node";
import { SessionManager } from "../src/services/session-manager.js";
import { MemorySessionStore } from "../src/services/store.js";
import type { AuthStrategy, LoginInfo } from "../src/auth/strategy.js";
import type { PersistedSession } from "../src/services/store.js";
import { registerAuthTools } from "../src/tools/auth.js";
import { registerReadTools } from "../src/tools/read.js";
import type { GuardianApi, GuardianContext } from "../src/api/guardian.js";

const FAKE_LESSONS = [
  { name: "Matematik", startDate: "2026-08-31T08:30", endDate: "2026-08-31T09:50", room: "A12" },
  { name: "Svenska", startDate: "2026-08-31T10:10", endDate: "2026-08-31T11:30", room: "B03" },
];

const CONTEXT: GuardianContext = {
  userId: 21,
  parentName: "Test Testsson",
  childInFocus: 100,
  children: [
    { studentId: 100, firstName: "Ett", lastName: "T", schools: [{ orgId: 20, name: "Testskolan", className: "4B" }] },
    { studentId: 101, firstName: "Två", lastName: "T", schools: [{ orgId: 20, name: "Testskolan", className: "1A" }] },
  ],
};

function fakeSchoolsoftClient(): SchoolsoftClient {
  return {
    school: "testskola",
    accessToken: "tok",
    refreshToken: "ref",
    cookieHeader: "JSESSIONID=x; hash=y; usertype=2",
    verifySession: async () => true,
  } as unknown as SchoolsoftClient;
}

const fakeApi = {
  getScheduleWeek: async (_week: number) => FAKE_LESSONS,
  getLunchWeek: async (_org: number, week: number) => [{ week, dayId: 5, dishes: [{ mealType: "Lunch", description: "Spagetti" }] }],
  getAssignmentsWeek: async () => [{ id: 7, title: "Läxa" }],
  getAssignmentDetail: async (id: number) => ({ view: { id }, sections: [] }),
  getNews: async () => [{ id: 1, title: "Studiedag fredag" }],
  getInbox: async () => [{ id: 5, subject: "Hej", isRead: false }, { id: 6, subject: "Läst", isRead: true }],
  getMessage: async (_u: number, _o: number, id: number) => ({ id, message: "Full text" }),
} as unknown as GuardianApi;

class FakeAuth implements AuthStrategy {
  readonly id = "fake";
  context?: GuardianContext;
  async login(_c: SchoolsoftClient): Promise<LoginInfo> {
    this.context = { ...CONTEXT };
    return { name: "Test Testsson", schoolName: "Testskolan", userType: "parent" };
  }
  async restore(_c: SchoolsoftClient, _s: PersistedSession): Promise<void> {
    this.context = { ...CONTEXT };
  }
  async focusChild(_c: SchoolsoftClient, studentId: number): Promise<void> {
    // Deliberately non-validating: SessionManager must guard this.
    this.context = { ...this.context!, childInFocus: studentId };
  }
}

let client: Client;
let manager: SessionManager;

before(async () => {
  process.env.SCHOOLSOFT_SCHOOL = "testskola";
  manager = new SessionManager({
    school: "testskola",
    store: new MemorySessionStore(),
    strategies: [new FakeAuth()],
    clientFactory: () => fakeSchoolsoftClient(),
  });

  const server = new McpServer({ name: "schoolsoft-mcp-server", version: "test" });
  registerAuthTools(server, () => manager);
  registerReadTools(server, () => manager, () => fakeApi);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "functional-test", version: "1.0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
});

after(async () => {
  await client.close();
});

test("tools/list exposes all 11 tools with annotations", async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    "schoolsoft_auth_status",
    "schoolsoft_get_assignment_detail",
    "schoolsoft_get_assignments",
    "schoolsoft_get_lunch_menu",
    "schoolsoft_get_message",
    "schoolsoft_get_messages",
    "schoolsoft_get_news",
    "schoolsoft_get_schedule",
    "schoolsoft_list_children",
    "schoolsoft_login",
    "schoolsoft_logout",
  ]);
  const sched = tools.find((t) => t.name === "schoolsoft_get_schedule");
  assert.equal(sched?.annotations?.readOnlyHint, true);
});

test("read tool before login returns actionable not-authenticated error", async () => {
  const res = await client.callTool({ name: "schoolsoft_get_schedule", arguments: {} });
  assert.equal(res.isError, true);
  const text = (res.content as { text: string }[])[0].text;
  assert.match(text, /schoolsoft_login/);
});

test("auth_status reports unauthenticated without prompting", async () => {
  const res = await client.callTool({ name: "schoolsoft_auth_status", arguments: {} });
  assert.equal(res.isError, undefined);
  const data = res.structuredContent as { authenticated: boolean };
  assert.equal(data.authenticated, false);
});

test("login → schedule → structured content flows end to end", async () => {
  const login = await client.callTool({ name: "schoolsoft_login", arguments: {} });
  const loginData = login.structuredContent as { status: string; user: LoginInfo };
  assert.equal(loginData.status, "logged_in");
  assert.equal(loginData.user.name, "Test Testsson");

  const res = await client.callTool({
    name: "schoolsoft_get_schedule",
    arguments: { week: 35 },
  });
  const data = res.structuredContent as { week: number; lessons: typeof FAKE_LESSONS; child: { studentId: number } };
  assert.equal(data.week, 35);
  assert.equal(data.lessons.length, 2);
  assert.equal(data.child.studentId, 100, "defaults to the child in focus");
  assert.equal(data.lessons[0].name, "Matematik");
});

test("child_id switches the child in focus and list_children reflects it", async () => {
  const sw = await client.callTool({ name: "schoolsoft_get_schedule", arguments: { child_id: 101 } });
  assert.equal(sw.isError, undefined, (sw.content as { text: string }[])[0]?.text);
  assert.equal((sw.structuredContent as { child: { studentId: number } }).child.studentId, 101);
  const list = await client.callTool({ name: "schoolsoft_list_children", arguments: {} });
  const data = list.structuredContent as { children: { studentId: number }[]; childInFocus: number };
  assert.equal(data.children.length, 2);
  assert.equal(data.childInFocus, 101);
  const bad = await client.callTool({ name: "schoolsoft_get_schedule", arguments: { child_id: 999 } });
  assert.equal(bad.isError, true);
  assert.match((bad.content as { text: string }[])[0].text, /Unknown child id 999/);
});

test("messages: unread filter and single-message fetch", async () => {
  const all = await client.callTool({ name: "schoolsoft_get_messages", arguments: {} });
  assert.equal(all.isError, undefined, (all.content as { text: string }[])[0]?.text);
  assert.equal((all.structuredContent as { messages: unknown[] }).messages.length, 2);
  const unread = await client.callTool({ name: "schoolsoft_get_messages", arguments: { unread_only: true } });
  const u = (unread.structuredContent as { messages: { id: number }[] }).messages;
  assert.deepEqual(u.map((m) => m.id), [5]);
  const one = await client.callTool({ name: "schoolsoft_get_message", arguments: { id: 5 } });
  assert.equal((one.structuredContent as { message: { message: string } }).message.message, "Full text");
});

test("Zod validation rejects out-of-range week", async () => {
  const res = await client.callTool({
    name: "schoolsoft_get_schedule",
    arguments: { week: 99 },
  });
  assert.equal(res.isError, true);
});

test("logout invalidates the session for subsequent calls", async () => {
  await client.callTool({ name: "schoolsoft_logout", arguments: {} });
  const res = await client.callTool({ name: "schoolsoft_get_news", arguments: {} });
  assert.equal(res.isError, true);
});
