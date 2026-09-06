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

const FAKE_LESSONS = [
  { subject: "Matematik", day: "Monday", startTime: "08:30", endTime: "09:50", room: "A12" },
  { subject: "Svenska", day: "Monday", startTime: "10:10", endTime: "11:30", room: "B03" },
];

function fakeSchoolsoftClient(): SchoolsoftClient {
  return {
    school: "testskola",
    accessToken: "tok",
    refreshToken: "ref",
    verifySession: async () => true,
    getSchedule: async (week?: number) => ({ week: week ?? 35, lessons: FAKE_LESSONS }),
    getLunch: async (_week: number) => [{ week: 35, friday: "Spagetti" }],
    getNews: async () => [{ id: 1, title: "Studiedag fredag", preview: "..." }],
  } as unknown as SchoolsoftClient;
}

class FakeAuth implements AuthStrategy {
  readonly id = "fake";
  async login(_c: SchoolsoftClient): Promise<LoginInfo> {
    return { name: "Test Testsson", schoolName: "Testskolan", userType: "2" };
  }
  async restore(_c: SchoolsoftClient, _s: PersistedSession): Promise<void> {}
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
  registerReadTools(server, () => manager);

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

test("tools/list exposes all 9 tools with annotations", async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    "schoolsoft_auth_status",
    "schoolsoft_get_assignment_detail",
    "schoolsoft_get_assignments",
    "schoolsoft_get_lunch_menu",
    "schoolsoft_get_news",
    "schoolsoft_get_schedule",
    "schoolsoft_get_subjects",
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
  const data = res.structuredContent as { week: number; lessons: typeof FAKE_LESSONS };
  assert.equal(data.week, 35);
  assert.equal(data.lessons.length, 2);
  assert.equal(data.lessons[0].subject, "Matematik");
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
