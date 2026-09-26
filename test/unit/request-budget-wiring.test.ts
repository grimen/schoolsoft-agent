/**
 * The request budget through the production wiring (createSessionManager,
 * createPortals, createApiPortal, createKeepalive) with the offline
 * SchoolSoft simulator at the injected fetch seam and a fake clock: every
 * upstream request passes the budget, the ceiling holds for two children and
 * keepalive together, keepalive sends nothing (and never probes) while the
 * portal pushes back, writes are never retried and never sent while the
 * breaker is open, and a cancelled request leaves the queue unsent.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AgentError,
  MemoryPendingLoginStore,
  MemorySessionHistoryStore,
  MemorySessionStore,
  PortalPushbackError,
  RequestCancelledError,
  createApiPortal,
  createKeepalive,
  createPortals,
  createRequestBudget,
  createSessionManager,
  getOperation,
  getProvider,
  requestBudgetOf,
  resolveConfig,
  runOperation,
  type AbsenceNotice,
  type Config,
  type RequestBudget,
} from "../../src/core/index.js";
import { SchoolsoftSim, savedSession } from "../helpers/schoolsoft-sim.js";
import { CountingBudget, FakeClock } from "../helpers/budget.js";

const SEC = 1_000;
const MIN = 60_000;

const NOTICE: AbsenceNotice = {
  studentId: 100,
  startDate: "2030-03-18",
  endDate: "2030-03-18",
  fullDay: true,
};

function wired(
  o: {
    budget?: (clock: FakeClock, config: Config) => RequestBudget;
    keepalive?: "off" | "app" | "all";
    ttlSeconds?: number;
    limits?: { requestsPerMinute?: number; requestBurst?: number };
  } = {},
) {
  const clock = new FakeClock();
  const sim = new SchoolsoftSim(clock.now);
  const sentAt: number[] = [];
  const fetch: typeof sim.fetch = (...args) => {
    sentAt.push(clock.now());
    return sim.fetch(...args);
  };
  const store = new MemorySessionStore();
  store.save({
    ...savedSession(clock.t, o.ttlSeconds),
    web: {
      savedAt: clock.t,
      landedOn: "https://sms.schoolsoft.se/taby/x",
      cookies: [{ name: "JSESSIONID", value: "web", domain: "sms.schoolsoft.se", path: "/" }],
    },
  });
  const config = resolveConfig(
    [{ school: "taby", configDir: "/nowhere", keepalive: o.keepalive, ...o.limits }],
    { home: "/unused", platform: "linux" },
  );
  const budget = o.budget
    ? o.budget(clock, config)
    : createRequestBudget(config, { now: clock.now, timer: clock });
  const manager = createSessionManager(config, {
    store,
    history: new MemorySessionHistoryStore(),
    now: clock.now,
    budget,
    fetchImpl: fetch,
    pending: new MemoryPendingLoginStore(),
    openBrowser: () => assert.fail("the budget never logs in"),
    webLogin: async () => assert.fail("the budget never logs in"),
  });
  const logs: string[] = [];
  const keepalive = createKeepalive(config, manager, {
    timer: clock,
    now: clock.now,
    random: () => 0,
    hourOf: () => 12,
    fetchImpl: fetch,
    log: (m) => logs.push(m),
  });
  const portals = createPortals(manager, { fetchImpl: fetch, browser: null });
  const ctx = {
    config,
    manager,
    provider: getProvider("schoolsoft"),
    ...portals,
    log: () => {},
  };
  return { clock, sim, sentAt, store, manager, keepalive, portals, budget, logs, fetch, ctx };
}

/** A read that may wait out a pause: advance the clock while it waits. */
async function settleRead<T>(
  clock: FakeClock,
  read: Promise<T>,
  ms = 10 * SEC,
): Promise<T | unknown> {
  const caught = read.catch((e: unknown) => e);
  await clock.advance(ms);
  return caught;
}

/** Three push-backs from the portal's reads: the breaker opens. */
async function openBreaker(w: ReturnType<typeof wired>) {
  w.sim.readAnswer = { status: 503 };
  for (let week = 30; week < 33; week++)
    await settleRead(w.clock, w.portals.freshPortal.getScheduleWeek(week));
  assert.equal(w.budget.snapshot().breaker, "open");
}

test("every request of the production wiring passes the budget: restore, session check, child switch, reads, the write, keepalive, the school list", async (t) => {
  const counting = new CountingBudget();
  const w = wired({ budget: () => counting, keepalive: "all", ttlSeconds: 60 });
  await w.manager.ensureSession();
  await w.manager.focusChild(101);
  const p = w.portals.freshPortal;
  const quietly = (x: Promise<unknown>) => x.catch(() => {}); // only the requests count here
  await quietly(p.getScheduleWeek(37));
  await quietly(p.getLunchWeek(20, 37, 2026));
  await quietly(p.getNews(21, 20, 101));
  await quietly(p.getInbox(21, 20));
  await quietly(p.getCalendar("2026-09-07", "2026-09-13"));
  await quietly(p.getActivityLog());
  await quietly(p.getGradePrognosis());
  await createApiPortal(w.manager, { fetchImpl: w.fetch }).reportAbsence(NOTICE);
  w.keepalive!.start();
  await w.clock.advance(61 * SEC); // the app task refreshes, the web task touches
  t.mock.method(globalThis, "fetch", async () =>
    Response.json([{ name: "Skolan", orgId: 1, evaUrl: "https://sms.schoolsoft.se/skolan/x/" }]),
  );
  const cache = join(mkdtempSync(join(tmpdir(), "budget-")), "schools.json");
  await getProvider("schoolsoft")
    .createSchoolDirectory(cache, requestBudgetOf(w.manager))
    .find("Skolan");
  const kinds = new Set(w.sim.requests.map((r) => r.replace(/\?.*/, "").replace(/\/\d+/g, "/N")));
  for (const expected of [
    "GET /taby/eva/api/v1/parent",
    "GET /taby/eva-apps/auth/login/parent",
    "GET /taby/rest-api/session",
    "POST /taby/rest-api/login/token",
    "GET /taby/rest-api/parent/header/parent",
    "POST /taby/rest-api/parent/absence-notice",
  ])
    assert.ok(kinds.has(expected), `${expected} was exercised (${[...kinds].join(", ")})`);
  assert.equal(
    counting.calls.length,
    w.sim.requests.length + 1,
    "one budget call per upstream request, plus the school list",
  );
  assert.equal(
    counting.calls.filter((c) => c.write).length,
    1,
    "only the absence report is a write",
  );
});

test("the ceiling holds for two children and keepalive together: never more than burst + rate × T", async () => {
  const w = wired({ keepalive: "all" });
  await w.manager.ensureSession();
  w.keepalive!.start();
  const schedule = getOperation("get_schedule")!;
  const runs = Array.from({ length: 40 }, (_, i) =>
    runOperation(schedule, w.ctx, { child_id: i % 2 ? 100 : 101, week: 10 + i, fresh: true }),
  );
  for (let minute = 0; minute < 30; minute++) await w.clock.advance(MIN);
  await Promise.all(runs);
  const touches = w.sim.requests.filter((r) => r.includes("/header/parent")).length;
  assert.ok(touches >= 2, `keepalive touched the web session too (${touches})`);
  const t = w.sentAt;
  assert.ok(t.length > 40, `${t.length} requests`);
  for (let i = 0; i < t.length; i++)
    for (let j = i; j < t.length; j++)
      assert.ok(
        j - i + 1 <= 10 + ((t[j] - t[i]) * 20) / MIN + 1e-9,
        `requests ${i}..${j} exceed the budget`,
      );
});

test("configured limits reach the budget", async () => {
  const w = wired({ limits: { requestsPerMinute: 6, requestBurst: 2 } });
  assert.deepEqual(w.budget.snapshot().limits, { perMinute: 6, burst: 2, maxInFlight: 2 });
});

test("keepalive sends nothing while the portal pushes back and never tests the water; a user read closes the breaker and it resumes", async () => {
  const w = wired({ keepalive: "all" });
  await w.manager.ensureSession();
  await openBreaker(w);
  const before = w.sim.requests.length;
  w.keepalive!.start();
  await w.clock.advance(30 * MIN); // well past the five-minute cool-down: half-open
  assert.equal(w.budget.snapshot().breaker, "half_open");
  assert.equal(w.sim.requests.length, before, "no keepalive request, not even as a probe");
  assert.ok(
    w.logs.some((l) => /keepalive: (app|web) skipped \(school portal pushing back\)/.test(l)),
    w.logs.join("\n"),
  );
  assert.deepEqual(
    w.keepalive!.status(),
    { app: "scheduled", web: "scheduled" },
    "skipping is not stopping",
  );
  w.sim.readAnswer = null;
  await w.portals.freshPortal.getScheduleWeek(40); // the user's read is the probe
  assert.equal(w.budget.snapshot().breaker, "closed");
  await w.clock.advance(11 * MIN);
  assert.ok(
    w.sim.requests.slice(before + 1).some((r) => r.includes("/header/parent")),
    "keepalive touches again once requests flow",
  );
  assert.notEqual(w.store.load(), null, "the saved session was kept throughout");
});

test("a write is never sent while the breaker is open, and never repeated after a 429 or a 5xx", async () => {
  const absencePosts = (sim: SchoolsoftSim) =>
    sim.requests.filter((r) => r.startsWith("POST") && r.includes("/absence-notice")).length;
  const open = wired();
  await open.manager.ensureSession();
  await openBreaker(open);
  await assert.rejects(
    createApiPortal(open.manager, { fetchImpl: open.fetch }).reportAbsence(NOTICE),
    (e) => e instanceof PortalPushbackError && e.reason === "paused" && !e.sent,
  );
  assert.equal(absencePosts(open.sim), 0, "refused before it was sent");

  for (const status of [429, 503]) {
    const w = wired();
    await w.manager.ensureSession();
    w.sim.readAnswer = { status, headers: { "retry-after": "1" } };
    await assert.rejects(
      createApiPortal(w.manager, { fetchImpl: w.fetch }).reportAbsence(NOTICE),
      (e) => {
        assert.ok(e instanceof AgentError && e.key === "write_outcome_unknown", String(e));
        assert.equal(e.params.detail, `HTTP ${status}`);
        assert.equal(e.retryable, false);
        return true;
      },
    );
    await w.clock.advance(MIN);
    assert.equal(absencePosts(w.sim), 1, `HTTP ${status}: sent exactly once`);
  }
});

test("a request cancelled while it waits in the budget's queue is never sent and frees its place", async () => {
  const w = wired({ limits: { requestsPerMinute: 1, requestBurst: 3 } });
  await w.manager.ensureSession(); // parent, cookie exchange, session check: the burst is spent
  const cancel = new AbortController();
  const queued = createPortals(w.manager, {
    fetchImpl: w.fetch,
    browser: null,
    signal: cancel.signal,
  }).freshPortal.getScheduleWeek(37);
  const next = w.portals.freshPortal.getScheduleWeek(38);
  await w.clock.advance(SEC);
  assert.equal(w.budget.snapshot().queued, 2);
  cancel.abort();
  await assert.rejects(queued, RequestCancelledError);
  await w.clock.advance(MIN);
  await next;
  assert.deepEqual(
    w.sim.reads.filter((r) => r.includes("/lessons/week/")).map((r) => /week\/(\d+)/.exec(r)![1]),
    ["38"],
    "the cancelled read never reached the portal; the next one took the token",
  );
});

test("a restore that meets the breaker keeps the saved session and records no loss", async () => {
  const w = wired();
  await w.manager.ensureSession();
  await openBreaker(w);
  const restarted = createSessionManager(w.ctx.config, {
    store: w.store,
    history: new MemorySessionHistoryStore(),
    now: w.clock.now,
    budget: w.budget,
    fetchImpl: w.fetch,
  });
  await assert.rejects(restarted.ensureSession(), PortalPushbackError);
  assert.notEqual(w.store.load(), null);
  const status = await runOperation(
    getOperation("auth_status")!,
    { ...w.ctx, manager: restarted },
    {},
  );
  assert.deepEqual(
    [
      (status as { authenticated: boolean }).authenticated,
      (status as { portal: { state: string } }).portal.state,
    ],
    [false, "paused"],
  );
});
