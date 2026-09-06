/**
 * Unit tests for GuardianApi: which backend (Bearer vs cookie) and which
 * path each call uses, and how HTTP errors surface. HTTP is injected.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GuardianApi,
  childOf,
  orgIdOf,
  type ApiFetch,
  type GuardianContext,
} from "../../src/core/api/guardian.js";

function harness(status = 200, data: unknown = []) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetchImpl: ApiFetch = async (url, _school, options) => {
    calls.push({ url, headers: (options.headers ?? {}) as Record<string, string> });
    return { status, data };
  };
  const api = new GuardianApi({
    school: "taby",
    accessToken: () => "TOK",
    cookieHeader: () => "JSESSIONID=a; hash=b; usertype=2",
    fetchImpl,
  });
  return { api, calls };
}

test("Eva endpoints use Bearer auth with the expected paths", async () => {
  const { api, calls } = harness();
  await api.getParent();
  await api.getLunchWeek(20, 37);
  await api.getNews(21, 20, 17);
  await api.getInbox(21, 20);
  await api.getMessage(21, 20, 99);
  const paths = calls.map((c) => c.url.replace("https://sms.schoolsoft.se/taby", ""));
  assert.deepEqual(paths, [
    "/eva/api/v1/parent",
    "/eva/api/v1/schools/20/lunchmenu/37",
    "/eva/api/v2/parent/21/schools/20/news?studentId=17&langId=1",
    "/eva/api/v1/parent/21/schools/20/messages/inbox",
    "/eva/api/v1/parent/21/schools/20/messages/99",
  ]);
  for (const c of calls) {
    assert.equal(c.headers.Authorization, "Bearer TOK");
    assert.equal(c.headers.Cookie, undefined);
  }
});

test("webview REST endpoints use the session cookies", async () => {
  const { api, calls } = harness();
  await api.getScheduleWeek(37);
  await api.getAssignmentsWeek(37, 2026);
  await api.getAssignmentDetail(5);
  const paths = calls.map((c) => c.url.replace("https://sms.schoolsoft.se/taby", "")).sort();
  assert.deepEqual(paths, [
    "/rest-api/parent/calendar/lessons/week/37",
    "/rest-api/parent/ps/assignments/5/sections",
    "/rest-api/parent/ps/assignments/5/view",
    "/rest-api/parent/ps/assignments/start-page?week=37&year=2026",
  ]);
  for (const c of calls) {
    assert.match(c.headers.Cookie, /JSESSIONID=a/);
    assert.equal(c.headers.Authorization, undefined);
  }
});

test("401 surfaces as a session rejection, other statuses as HTTP errors", async () => {
  await assert.rejects(harness(401).api.getParent(), /rejected the session \(HTTP 401\)/);
  await assert.rejects(harness(500).api.getScheduleWeek(1), /HTTP 500/);
});

test("missing token/cookies fail before any request", async () => {
  const api = new GuardianApi({
    school: "taby",
    accessToken: () => null,
    cookieHeader: () => null,
    fetchImpl: async () => {
      throw new Error("must not be called");
    },
  });
  await assert.rejects(api.getParent(), /No access token/);
  await assert.rejects(api.getScheduleWeek(1), /No session cookies/);
});

test("childOf/orgIdOf resolve the child in focus and reject unknown ids", () => {
  const ctx: GuardianContext = {
    userId: 1,
    parentName: "P",
    childInFocus: 2,
    children: [
      {
        studentId: 2,
        firstName: "A",
        lastName: "X",
        schools: [{ orgId: 20, name: "S", className: "4B" }],
      },
      {
        studentId: 3,
        firstName: "B",
        lastName: "X",
        schools: [{ orgId: 21, name: "T", className: "1A" }],
      },
    ],
  };
  assert.equal(childOf(ctx).studentId, 2);
  assert.equal(orgIdOf(childOf(ctx, 3)), 21);
  assert.throws(() => childOf(ctx, 9), /Unknown child id 9.*2 \(A\), 3 \(B\)/);
});
