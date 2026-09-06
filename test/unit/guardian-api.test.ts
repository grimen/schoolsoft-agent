/**
 * Unit tests for Portal: which backend (Bearer vs cookie) and which
 * path each call uses, and how HTTP errors surface. HTTP is injected.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiPortal, type ApiFetch } from "../../src/providers/schoolsoft/portal/api-portal.js";
import { childOf, orgIdOf, type GuardianContext } from "../../src/core/portal/guardian.js";

function harness(status = 200, data: unknown = []) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetchImpl: ApiFetch = async (url, _school, options) => {
    calls.push({ url, headers: (options.headers ?? {}) as Record<string, string> });
    return { status, data };
  };
  const api = new ApiPortal({
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
  const api = new ApiPortal({
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

test("grade prognosis uses the web-login cookies and refuses without them", async () => {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetchImpl: ApiFetch = async (url, _school, options) => {
    calls.push({ url, headers: (options.headers ?? {}) as Record<string, string> });
    return { status: 200, data: [{ id: 1 }] };
  };
  const noWeb = new ApiPortal({
    school: "taby",
    accessToken: () => "TOK",
    cookieHeader: () => "JSESSIONID=app",
    fetchImpl,
  });
  await assert.rejects(noWeb.getGradePrognosis(), /login --web/);
  const withWeb = new ApiPortal({
    school: "taby",
    accessToken: () => "TOK",
    cookieHeader: () => "JSESSIONID=app",
    webCookieHeader: () => "JSESSIONID=web; hash=h",
    fetchImpl,
  });
  const r = await withWeb.getGradePrognosis();
  assert.deepEqual(r, { reconciliationDates: [{ id: 1 }] });
  assert.match(calls[0].url, /\/rest-api\/parent\/gradeprognosis\/options\/reconciliationdates$/);
  assert.equal(calls[0].headers.Cookie, "JSESSIONID=web; hash=h");
});

test("web child sync: reads the web header, PUTs only when the child differs, no-op without a target", async () => {
  const calls: string[] = [];
  let current = { currentChildId: 1, currentOrgId: 20 };
  const fetchImpl: ApiFetch = async (url, _school, options) => {
    const o = options as { method?: string; headers?: Record<string, string> };
    calls.push(
      `${o.method ?? "GET"} ${new URL(url).pathname}${new URL(url).search} cookie=${o.headers?.Cookie}`,
    );
    if (o.method === "PUT") {
      current = {
        currentChildId: Number(new URL(url).searchParams.get("childId")),
        currentOrgId: 20,
      };
      return { status: 200, data: "" };
    }
    return { status: 200, data: current };
  };
  let target: { childId: number; orgId: number } | null = { childId: 1, orgId: 20 };
  const api = new ApiPortal({
    school: "taby",
    accessToken: () => "T",
    cookieHeader: () => "JSESSIONID=app",
    webCookieHeader: () => "JSESSIONID=web",
    webChildTarget: () => target,
    fetchImpl,
  });
  await api.syncWebChild();
  assert.deepEqual(
    calls,
    ["GET /taby/rest-api/parent/header/parent cookie=JSESSIONID=web"],
    "same child: no PUT",
  );
  assert.deepEqual(await api.getWebChildInFocus(), { childId: 1, orgId: 20 });
  calls.length = 0;
  target = { childId: 2, orgId: 20 };
  await api.syncWebChild();
  assert.deepEqual(calls, [
    "GET /taby/rest-api/parent/header/parent cookie=JSESSIONID=web",
    "PUT /taby/rest-api/parent/header/parent?childId=2&orgId=20 cookie=JSESSIONID=web",
  ]);
  calls.length = 0;
  await api.getGradePrognosis();
  assert.equal(calls.length, 2, "prognosis syncs (GET, already child 2) then reads");
  assert.match(calls[1], /reconciliationdates/);
  calls.length = 0;
  target = null;
  await api.syncWebChild();
  assert.deepEqual(calls, [], "no target: the web session is left alone");
  const noWeb = new ApiPortal({
    school: "taby",
    accessToken: () => "T",
    cookieHeader: () => "JSESSIONID=app",
    fetchImpl,
  });
  await assert.rejects(noWeb.focusWebChild(1, 20), /login --web/);
  const rejecting = new ApiPortal({
    school: "taby",
    accessToken: () => "T",
    cookieHeader: () => null,
    webCookieHeader: () => "JSESSIONID=web",
    fetchImpl: async () => ({ status: 401, data: "" }),
  });
  await assert.rejects(rejecting.focusWebChild(1, 20), /login --web/);
});

test("subject rooms come from the subjectroom REST (app cookies): list, then teachers per room", async () => {
  const calls: string[] = [];
  const fetchImpl: ApiFetch = async (url, _school, options) => {
    const path = new URL(url).pathname.replace(/^\/taby/, "");
    calls.push(`${path} cookie=${(options.headers as Record<string, string>).Cookie}`);
    if (path.endsWith("/subjectroom/all"))
      return {
        status: 200,
        data: [
          { activityId: 11, subject: "Matematik", groupNames: ["4B"], isSubjectRoom: true },
          { activityId: 12, subject: "Fritids", isSubjectRoom: false },
          { activityId: 13, subject: "Bild", groupNames: ["4B", "4C"] },
        ],
      };
    return {
      status: 200,
      data: [{ firstName: "Lärare", lastName: "Test", id: 1, role: "TEACHER" }],
    };
  };
  const api = new ApiPortal({
    school: "taby",
    accessToken: () => "T",
    cookieHeader: () => "JSESSIONID=app",
    fetchImpl,
  });
  const rooms = await api.getSubjectRooms();
  assert.deepEqual(rooms, [
    { subject: "Matematik", subjectId: 11, groups: ["4B"], teachers: ["Lärare Test"] },
    { subject: "Bild", subjectId: 13, groups: ["4B", "4C"], teachers: ["Lärare Test"] },
  ]);
  assert.deepEqual(calls, [
    "/rest-api/parent/ps/subjectroom/all cookie=JSESSIONID=app",
    "/rest-api/parent/ps/subjectroom/11/teachers cookie=JSESSIONID=app",
    "/rest-api/parent/ps/subjectroom/13/teachers cookie=JSESSIONID=app",
  ]);
});

test("orgIdOf rejects a child without schools; focusWebChild surfaces other HTTP failures; rooms without groupNames", async () => {
  assert.throws(
    () => orgIdOf({ studentId: 9, firstName: "x", lastName: "y", schools: [] }),
    /Child 9 has no school/,
  );
  const api500 = new ApiPortal({
    school: "taby",
    accessToken: () => "T",
    cookieHeader: () => "JSESSIONID=app",
    webCookieHeader: () => "JSESSIONID=web",
    fetchImpl: async (url) =>
      /subjectroom\/all/.test(url)
        ? { status: 200, data: [{ activityId: 1, subject: "Bild" }] }
        : { status: 500, data: "" },
  });
  await assert.rejects(api500.focusWebChild(1, 20), /HTTP 500 when selecting child 1/);
  const rooms = await api500.getSubjectRooms().catch(() => null);
  assert.equal(rooms, null, "teachers call failed with 500");
  const apiRooms = new ApiPortal({
    school: "taby",
    accessToken: () => "T",
    cookieHeader: () => "JSESSIONID=app",
    fetchImpl: async (url) =>
      /subjectroom\/all/.test(url)
        ? { status: 200, data: [{ activityId: 1, subject: "Bild" }] }
        : { status: 200, data: [] },
  });
  assert.deepEqual(await apiRooms.getSubjectRooms(), [
    { subject: "Bild", subjectId: 1, groups: [], teachers: [] },
  ]);
});

test("calendar event and session endpoints; activity log maps the legacy POST and its errors", async () => {
  const { api, calls } = harness(200, { next: 1 });
  await api.getNextCalendarEvent(21, 20, 100);
  assert.match(
    calls[0].url,
    /\/eva\/api\/v1\/parent\/21\/schools\/20\/news\/calendarevent\/next\?studentId=100$/,
  );
  assert.equal(calls[0].headers.Authorization, "Bearer TOK");
  await api.getSession();
  assert.match(calls[1].url, /\/rest-api\/session$/);
  assert.match(calls[1].headers.Cookie, /JSESSIONID=a/);

  const rows = [
    {
      blogPost: {
        id: 1,
        creDate: 1_700_000_000_000,
        name: "Utflykt",
        description: "<p>Kort &nbsp;text</p>",
      },
      author: "Lärare",
      recipientsNamesString: "4B",
      numberOfComments: 2,
      content: [
        {
          contentBlockDTOList: [
            {
              blockType: "text",
              contentBlocks: [{ content: "<b>Hej</b> alla" }, { content: "" }, {}],
            },
            { blockType: "image", contentBlocks: [{}, {}] },
            { blockType: "image" },
            { blockType: "text" },
            { blockType: "other" },
          ],
        },
        {},
      ],
    },
    {
      blogPost: { id: 2, creDate: "2026-09-01", name: "Bara rubrik", description: "Samma" },
      content: [
        { contentBlockDTOList: [{ blockType: "text", contentBlocks: [{ content: "Samma" }] }] },
      ],
    },
    { blogPost: { id: 3, creDate: 1, name: "Tom" } },
  ];
  const posts: { url: string; body: string; method: string }[] = [];
  const mk = (status: number, data: unknown, cookie: string | null = "JSESSIONID=a") =>
    new ApiPortal({
      school: "taby",
      accessToken: () => "T",
      cookieHeader: () => cookie,
      fetchImpl: async (url, _s, options) => {
        const o = options as { method?: string; body?: string };
        posts.push({ url, body: o.body ?? "", method: o.method ?? "GET" });
        return { status, data };
      },
    });
  const entries = await mk(200, rows).getActivityLog(3);
  assert.equal(posts[0].method, "POST");
  assert.match(posts[0].url, /\/rest\/blogpost\/getbyloggedinuser$/);
  assert.equal(JSON.parse(posts[0].body).row_count, 3);
  assert.deepEqual(entries[0], {
    id: 1,
    date: "2023-11-14T22:13:20.000Z",
    title: "Utflykt",
    author: "Lärare",
    text: "Hej alla",
    summary: "Kort text",
    images: 2,
    recipients: "4B",
    comments: 2,
  });
  assert.deepEqual(entries[1], {
    id: 2,
    date: "2026-09-01",
    title: "Bara rubrik",
    text: "Samma",
    comments: 0,
  });
  assert.equal(entries[2].text, "");
  assert.deepEqual(await mk(200, { not: "array" }).getActivityLog(), []);
  await assert.rejects(mk(401, null).getActivityLog(), /rejected the session \(HTTP 401\)/);
  await assert.rejects(mk(500, null).getActivityLog(), /HTTP 500/);
  await assert.rejects(mk(200, [], null).getActivityLog(), /No session cookies/);
});
