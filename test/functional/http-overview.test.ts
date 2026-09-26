/** The composite overview over real HTTP: the real OAuth provider, runtime, provider,
 * read cache and request budget, with the fake portal at the injected fetch seam. */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createRequestBudget,
  getOperation,
  stockholmToday,
  weekOf,
  weekOfDate,
} from "../../src/core/index.js";
import { OverviewSchema } from "../../src/http/overview.js";
import { FakeClock } from "../helpers/budget.js";
import { FAKE_LUNCH_DISH } from "../packaging/connector-smoke/fake-upstream.mjs";
import { ALL, ALVA, BO, assertProblem, fixture, origin } from "../helpers/rest-connector.js";

const DAY = 86_400_000;
const today = () => stockholmToday();
const inDays = (days: number) =>
  new Date(Date.parse(today() + "T00:00:00Z") + days * DAY).toISOString().slice(0, 10);
/** A school-event agenda around today: one over, one tomorrow at nine, one all-day later. */
const agenda = () => [
  { eventId: 31, name: "Over", startDate: inDays(-2), endDate: inDays(-1), allDay: true },
  { eventId: 33, name: "Trip", startDate: inDays(3), endDate: inDays(3), allDay: true },
  {
    eventId: 32,
    name: "Parents' evening",
    startDate: inDays(1) + "T09:00",
    endDate: inDays(1) + "T10:00",
    allDay: false,
  },
];
const ok = (data: unknown) => ({ status: 200, data, headers: {}, setCookies: [] });
const reads = (calls: string[]) => calls.filter((call) => !call.includes("/login/"));

type Body = ReturnType<typeof OverviewSchema.parse>;
const sections = (body: Body) =>
  Object.fromEntries(
    (["schedule", "lunch", "nextEvent"] as const).map((key) => [key, body[key].status]),
  );

test("one request answers a child's week, lunch and next event, named by Stockholm dates", async (t) => {
  const f = await fixture(t);
  const { access } = await f.connect(ALL, [ALVA, BO]);
  // The fake portal records what it answers; the agenda answered here is counted apart.
  let agendas = 0;
  f.intercept(async (path) => {
    if (!path.endsWith("/calendar/event/agenda")) return undefined;
    agendas++;
    return ok(agenda());
  });
  const before = f.upstream.calls.length;
  const reply = await f.api(`/children/${BO}/overview`, access);
  assert.equal(reply.status, 200, reply.text);
  assert.match(reply.headers.get("content-type")!, /^application\/json/);
  const body = reply.json() as Body;
  assert.deepEqual(OverviewSchema.parse(body), body, "the documented shape, nothing more");
  assert.deepEqual(body.child, {
    id: BO,
    firstName: "Synthetic Bo",
    schoolName: "Synthetic School",
    className: "0A",
  });
  assert.deepEqual(body.week, { ...weekOf(), today: today(), timezone: "Europe/Stockholm" });
  assert.deepEqual(sections(body), { schedule: "ok", lunch: "ok", nextEvent: "ok" });
  assert.equal(body.schedule.status, "ok");
  const schedule = body.schedule.data as Record<string, unknown> & { lessons: { note: string }[] };
  assert.deepEqual(getOperation("get_schedule")!.output!.parse(schedule), schedule);
  assert.deepEqual(
    [schedule.year, schedule.week, schedule.startDate, schedule.endDate],
    [body.week.year, body.week.week, body.week.startDate, body.week.endDate],
  );
  assert.equal(schedule.lessons[0].note, `servedForChild=${BO}`);
  assert.equal(body.lunch.status, "ok");
  const lunch = body.lunch.data as { year: number; days: { dishes: { description: string }[] }[] };
  assert.equal(lunch.year, body.week.year);
  assert.equal(lunch.days[0].dishes[0].description, FAKE_LUNCH_DISH);
  assert.equal(body.nextEvent.status, "ok");
  const next = body.nextEvent.data as { event: { id: string; start: string }; from: string };
  assert.equal(next.event.id, `event:32@${inDays(1)}T09:00:00` + next.event.start.slice(19));
  assert.equal(next.from, today());
  assert.equal((body.nextEvent.data as { until: string }).until, inDays(29));

  // One child switch, then one schedule, one lunch and two calendar reads: five in all.
  const cold = f.upstream.calls.slice(before);
  assert.equal(cold.length + agendas, 5, cold.join("\n"));
  assert.equal(cold.filter((call) => call.includes("/eva-apps/auth/login/")).length, 1);
  // Warm: every section comes from the read cache.
  const warm = f.upstream.calls.length;
  assert.equal((await f.api(`/children/${BO}/overview`, access)).status, 200);
  assert.deepEqual(f.upstream.calls.slice(warm), [], "a warm overview sends nothing");
  const fresh = await f.api(`/children/${BO}/overview?fresh=true`, access);
  assert.equal(fresh.status, 200);
  assert.equal(
    reads(f.upstream.calls.slice(warm)).length + agendas,
    3 + 2,
    "fresh=true reads every section (the agenda twice by now)",
  );

  // Any day names its week; the lunch and schedule sections follow it.
  const next7 = inDays(7);
  const later = (await f.api(`/children/${BO}/overview?date=${next7}`, access)).json() as Body;
  assert.deepEqual(later.week, {
    ...weekOfDate(next7),
    today: today(),
    timezone: "Europe/Stockholm",
  });
  assert.equal(later.schedule.status, "ok");
  assert.equal((later.schedule.data as { week: number }).week, weekOfDate(next7).week);
});

test("a grant without the child or any section's scope is refused before any upstream read", async (t) => {
  const f = await fixture(t);
  const narrow = await f.connect(["list_children", "get_schedule"], [ALVA]);
  const none = await f.connect(["list_children"], [ALVA]);
  const calls = f.upstream.calls.length;
  for (const child of [BO, 999]) {
    const refused = await f.api(`/children/${child}/overview`, narrow.access);
    assertProblem(refused, 403, "child-not-permitted");
    assert.doesNotMatch(refused.text, /Synthetic Bo/);
  }
  const unscoped = await f.api(`/children/${ALVA}/overview`, none.access);
  const body = assertProblem(unscoped, 403, "scope-not-granted");
  assert.equal(body.error, "insufficient_scope");
  assert.match(
    unscoped.headers.get("www-authenticate")!,
    /scope="get_schedule get_lunch_menu get_calendar"/,
  );
  for (const path of [
    "?date=2026-02-30",
    "?date=26-09-26",
    `?date=${inDays(1)}&date=${inDays(2)}`,
    "?week=39",
    "?fresh=yes",
    `?date=${inDays(240)}`,
  ])
    assertProblem(
      await f.api(`/children/${ALVA}/overview${path}`, narrow.access),
      400,
      "invalid-input",
    );
  assertProblem(await f.api("/children/abc/overview", narrow.access), 400, "invalid-input");
  assert.deepEqual(f.upstream.calls.slice(calls), [], "no upstream request at all");

  // Granted only the schedule: the others say so, and only the schedule is read.
  const reply = await f.api(`/children/${ALVA}/overview`, narrow.access);
  assert.equal(reply.status, 200);
  const partial = reply.json() as Body;
  assert.deepEqual(sections(partial), {
    schedule: "ok",
    lunch: "not-granted",
    nextEvent: "not-granted",
  });
  assert.deepEqual(partial.lunch, { status: "not-granted", scope: "get_lunch_menu" });
  assert.deepEqual(partial.nextEvent, { status: "not-granted", scope: "get_calendar" });
  const sent = f.upstream.calls.slice(calls);
  assert.ok(!sent.some((call) => /lunchmenu|agenda/.test(call)), sent.join("\n"));
});

test("a failing section carries its problem; the others are served", async (t) => {
  const f = await fixture(t, { lang: "sv" });
  const { access } = await f.connect(ALL, [ALVA]);
  f.intercept(async (path) => {
    if (/\/lunchmenu\//.test(path)) return { status: 500, data: null, headers: {}, setCookies: [] };
    if (path.endsWith("/calendar/event/agenda")) return ok([{ eventId: "x", renamed: true }]);
    return undefined;
  });
  const reply = await f.api(`/children/${ALVA}/overview`, access);
  assert.equal(reply.status, 200, reply.text);
  assert.equal(reply.headers.get("content-language"), "sv");
  const body = reply.json() as Body;
  assert.deepEqual(sections(body), { schedule: "ok", lunch: "error", nextEvent: "error" });
  assert.equal(body.lunch.status, "error");
  assert.equal(body.lunch.problem.type, "urn:schoolsoft-agent:problem:upstream");
  assert.equal(body.lunch.problem.status, 502);
  assert.equal(body.lunch.problem.retryable, true);
  assert.equal(body.nextEvent.status, "error");
  assert.equal(body.nextEvent.problem.type, "urn:schoolsoft-agent:problem:response-drift");
  assert.match(body.nextEvent.problem.detail, /get_calendar har ändrat form/);
  assert.doesNotMatch(reply.text, /renamed/);
  const english = await f.api(`/children/${ALVA}/overview`, access, { "Accept-Language": "en" });
  assert.equal(english.headers.get("content-language"), "en");
  const problem = (english.json() as Body).lunch as { problem: { detail: string } };
  assert.doesNotMatch(problem.problem.detail, /[åäö]/);
});

test("overviews for two children in parallel never carry the other child's data", async (t) => {
  const f = await fixture(t);
  const { access } = await f.connect(ALL, [ALVA, BO]);
  const replies = await Promise.all(
    Array.from({ length: 8 }, (_, i) => {
      const child = i % 2 ? BO : ALVA;
      return f
        .api(`/children/${child}/overview${i % 4 < 2 ? "" : "?fresh=true"}`, access)
        .then((reply) => ({ child, reply }));
    }),
  );
  for (const { child, reply } of replies) {
    assert.equal(reply.status, 200, reply.text);
    const body = reply.json() as Body;
    assert.equal(body.child.id, child);
    for (const key of ["schedule", "lunch"] as const) {
      const section = body[key];
      assert.equal(section.status, "ok");
      assert.equal((section.data as { child: { id: number } }).child.id, child);
    }
    const lessons = (body.schedule as { data: { lessons: { note: string }[] } }).data.lessons;
    assert.equal(lessons[0].note, `servedForChild=${child}`);
  }
});

test("the token, the grant and the connector's SchoolSoft session fail the whole overview", async (t) => {
  const f = await fixture(t);
  const { access, grantId } = await f.connect(ALL, [ALVA]);
  assert.equal((await f.request(`/api/v1/children/${ALVA}/overview`)).status, 401);
  f.intercept((path) => {
    if (/\/lunchmenu\//.test(path)) f.oauth.revokeGrant(grantId);
    return undefined;
  });
  const revoked = await f.api(`/children/${ALVA}/overview`, access);
  assertProblem(revoked, 401, "oauth-token");
  assert.doesNotMatch(revoked.text, /Synthetic lesson|servedForChild/);

  const later = await f.connect(ALL, [ALVA]);
  f.intercept(async (path) =>
    path.includes("/lessons/week/") || path.includes("/login/token")
      ? { status: 401, data: null, headers: {}, setCookies: [] }
      : undefined,
  );
  const signedOut = await f.api(`/children/${ALVA}/overview?fresh=true`, later.access);
  const body = assertProblem(signedOut, 409, "schoolsoft-session");
  assert.equal(body.ownerDashboard, origin + "/owner");
});

test("the overview honours the request budget: after push-back the rest is refused unsent", async (t) => {
  const clock = new FakeClock(Date.now());
  const budget = createRequestBudget(
    { provider: "schoolsoft", requestBudget: {} },
    { now: clock.now, timer: clock },
  );
  const f = await fixture(t, { budget, now: clock.now });
  const { access } = await f.connect(ALL, [ALVA]);
  let sent = 0;
  f.intercept(async (path) => {
    if (path.includes("/login/")) return undefined;
    sent++;
    return { status: 429, data: null, headers: { "retry-after": "60" }, setCookies: [] };
  });
  const reply = await f.api(`/children/${ALVA}/overview?fresh=true`, access);
  assert.equal(reply.status, 200, reply.text);
  const body = reply.json() as Body;
  assert.equal(sent, 1, "only the first section reached the portal");
  for (const key of ["schedule", "lunch", "nextEvent"] as const) {
    const section = body[key];
    assert.equal(section.status, "error", key);
    assert.equal(section.problem.type, "urn:schoolsoft-agent:problem:portal-pushback", key);
    assert.equal(section.problem.retryAt, new Date(clock.now() + 60_000).toISOString(), key);
  }
});
