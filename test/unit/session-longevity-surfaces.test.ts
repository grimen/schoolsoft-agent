/**
 * Where users meet session longevity: configuration (validated, with errors
 * in both languages), auth_status and doctor (observed lifetimes), `fresh`,
 * the error that says how long the web login lasted, the connector's owner
 * page and its encrypted history. Production wiring, offline stand-in.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type AddressInfo } from "node:net";
import { once } from "node:events";
import { SchoolsoftClient } from "@elias4044/ssp-node";
import {
  ConfigValueError,
  DEFAULT_CACHE_TTL_MS,
  FileSessionHistoryStore,
  MemoryReadCache,
  MemorySessionHistoryStore,
  MemorySessionStore,
  SessionHistoryRecorder,
  SessionLostError,
  createPortals,
  createSessionManager,
  describeError,
  envSource,
  getOperation,
  operations,
  parseQuietHours,
  resolveConfig,
  runOperation,
  withWebSessionObserver,
  type Capability,
  type OperationContext,
  type ReadCache,
} from "../../src/core/index.js";
import { WEB_SESSION_CAPABILITIES } from "../../src/providers/schoolsoft/routing.js";
import { schoolsoftProvider } from "../../src/providers/schoolsoft/index.js";
import { runDoctor } from "../../src/cli/commands/doctor.js";
import { signInHistory } from "../../src/http/pages.js";
import { startConnector } from "../../src/http/start.js";
import { CountingPortal } from "../helpers/counting-portal.js";
import { FakeTimer } from "../helpers/fake-timer.js";
import { SchoolsoftSim, savedSession } from "../helpers/schoolsoft-sim.js";

const defaults = { home: "/unused", platform: "linux" as const };
const MIN = 60_000;

test("config: keepalive is off and the cache on by default; env and file keys select modes, interval and quiet hours", () => {
  const base = resolveConfig([{ school: "s" }], defaults);
  assert.deepEqual(base.keepalive, { mode: "off", webIntervalMs: 10 * MIN, quietHours: null });
  assert.equal(base.cache, true);
  const env = envSource({
    SCHOOLSOFT_KEEPALIVE: "all",
    SCHOOLSOFT_KEEPALIVE_WEB_MINUTES: "15",
    SCHOOLSOFT_KEEPALIVE_QUIET_HOURS: "22-6",
    SCHOOLSOFT_CACHE: "off",
  });
  const c = resolveConfig([{ school: "s" }, env], defaults);
  assert.deepEqual(c.keepalive, {
    mode: "all",
    webIntervalMs: 15 * MIN,
    quietHours: { startHour: 22, endHour: 6 },
  });
  assert.equal(c.cache, false);
  assert.equal(resolveConfig([{ school: "s", cache: "on" }], defaults).cache, true);
  assert.equal(resolveConfig([{ school: "s", cache: true }], defaults).cache, true);
  assert.equal(resolveConfig([{ school: "s", cache: false }], defaults).cache, false);
  assert.equal(resolveConfig([{ school: "s", keepalive: "app" }], defaults).keepalive.mode, "app");
  assert.deepEqual(parseQuietHours(" 0-23 "), { startHour: 0, endHour: 23 });
  assert.equal(parseQuietHours(undefined), null);
});

test("config: invalid values are AgentErrors that name the setting, in English and Swedish", () => {
  const bad: [Record<string, string | number>, RegExp][] = [
    [{ keepalive: "always" }, /keepalive .*"always".*off \| app \| all/],
    [{ keepaliveWebMinutes: 1 }, /keepaliveWebMinutes .*"1".*5-120/],
    [{ keepaliveWebMinutes: 121 }, /keepaliveWebMinutes/],
    [{ keepaliveWebMinutes: "7.5" }, /keepaliveWebMinutes/],
    [{ keepaliveWebMinutes: "often" }, /keepaliveWebMinutes/],
    [{ keepaliveQuietHours: "22" }, /keepaliveQuietHours .*HH-HH/],
    [{ keepaliveQuietHours: "24-6" }, /keepaliveQuietHours/],
    [{ keepaliveQuietHours: "6-24" }, /keepaliveQuietHours/],
    [{ keepaliveQuietHours: "7-7" }, /keepaliveQuietHours/],
    [{ cache: "sometimes" }, /cache .*on \| off/],
  ];
  for (const [source, message] of bad) {
    assert.throws(
      () => resolveConfig([{ school: "s", ...source }], defaults),
      (e: unknown) => {
        assert.ok(e instanceof ConfigValueError, JSON.stringify(source));
        assert.match(e.message, message);
        assert.equal(e.kind, "input");
        const sv = describeError(e, "sv", "cli");
        assert.match(sv.message, /^Inställningen /);
        assert.equal(sv.exitCode, 6);
        return true;
      },
    );
  }
});

function wired(
  t: { mock: { method: typeof import("node:test").mock.method } },
  o: { cache?: ReadCache | null; configCache?: string; web?: boolean } = {},
) {
  t.mock.method(SchoolsoftClient.prototype, "verifySession", async () => true);
  let now = 1_900_000_000_000;
  const sim = new SchoolsoftSim(() => now);
  const store = new MemorySessionStore();
  store.save({
    ...savedSession(now),
    web: o.web
      ? {
          savedAt: now - 30 * MIN,
          landedOn: "https://sms.schoolsoft.se/taby/x",
          cookies: [{ name: "JSESSIONID", value: "web", domain: "sms.schoolsoft.se", path: "/" }],
        }
      : undefined,
  });
  const history = new MemorySessionHistoryStore();
  const config = resolveConfig(
    [{ school: "taby", configDir: "/nowhere", cache: o.configCache }],
    defaults,
  );
  const manager = createSessionManager(config, {
    store,
    history,
    cache: o.cache,
    now: () => now,
    fetchImpl: sim.fetch,
  });
  const portals = createPortals(manager, { fetchImpl: sim.fetch, browser: null });
  const ctx: OperationContext = {
    manager,
    config,
    provider: schoolsoftProvider,
    log: () => {},
    ...portals,
  };
  return {
    sim,
    store,
    history,
    manager,
    config,
    ctx,
    portals,
    advance: (ms: number) => (now += ms),
  };
}

test("wiring: reads are cached per child, `fresh: true` goes upstream, and login state changes empty the cache", async (t) => {
  const w = wired(t);
  const schedule = getOperation("get_schedule")!;
  const first = await runOperation(schedule, w.ctx, { week: 2 });
  assert.deepEqual(await runOperation(schedule, w.ctx, { week: 2 }), first);
  assert.equal(w.sim.reads.length, 1);
  const fresh = await runOperation(schedule, w.ctx, { week: 2, fresh: true });
  assert.notDeepEqual(fresh, first);
  assert.equal(w.sim.reads.length, 2);
  assert.deepEqual(
    await runOperation(schedule, w.ctx, { week: 2 }),
    fresh,
    "fresh replaced the entry",
  );
  assert.deepEqual(await runOperation(schedule, w.ctx, { week: 2, fresh: false }), fresh);

  const other = (await runOperation(schedule, w.ctx, { week: 2, child_id: 101 })) as {
    lessons: string[];
  };
  assert.match(other.lessons[0], /^JSESSIONID=101;/);
  const back = (await runOperation(schedule, w.ctx, { week: 2, child_id: 100 })) as {
    lessons: string[];
  };
  assert.match(back.lessons[0], /^JSESSIONID=100;/);
  assert.equal(w.sim.reads.length, 4, "child switches emptied the cache both ways");

  await runOperation(schedule, w.ctx, { week: 2 });
  w.advance(31 * MIN);
  await runOperation(schedule, w.ctx, { week: 2 });
  assert.equal(w.sim.reads.length, 5, "expired after its 30 minutes");

  w.manager.logout();
  await assert.rejects(runOperation(schedule, w.ctx, { week: 2 }), /Not logged in/);
  assert.equal(w.sim.reads.length, 5, "logged out: nothing cached is served, nothing is read");
});

test("wiring: a context without a fresh portal simply runs the operation; the cache can be switched off or injected", async (t) => {
  const off = wired(t, { configCache: "off" });
  assert.equal(off.portals.portal, off.portals.freshPortal, "no cache: one portal");
  await off.manager.ensureSession();
  await off.portals.portal.getScheduleWeek(2);
  await off.portals.portal.getScheduleWeek(2);
  assert.equal(off.sim.reads.length, 2);
  const { freshPortal: _unused, ...bare } = off.ctx;
  await runOperation(getOperation("get_schedule")!, bare, { week: 2, fresh: true });
  assert.equal(off.sim.reads.length, 3);

  const disabled = wired(t, { cache: null });
  assert.equal(disabled.portals.portal, disabled.portals.freshPortal);

  const mine = new MemoryReadCache();
  const injected = wired(t, { cache: mine });
  await injected.manager.ensureSession();
  await injected.portals.portal.getScheduleWeek(2);
  assert.equal(mine.size(), 1);
});

test("every operation that can be answered from the cache declares `fresh`, and no other does", () => {
  for (const op of operations) {
    const cacheable = op.portal.some((c) => DEFAULT_CACHE_TTL_MS[c as Capability] !== undefined);
    assert.equal("fresh" in op.input, cacheable, op.name);
    if (cacheable) assert.match(op.description, /- fresh \(boolean, optional\)/, op.name);
  }
});

test("gated reads: each success is a web-session use; a loss says how long the login had been idle, in both languages", async () => {
  let now = 1_000_000;
  const historyStore = new MemorySessionHistoryStore();
  const recorder = new SessionHistoryRecorder(historyStore, () => now);
  const upstream = new CountingPortal(() => 100);
  const portal = withWebSessionObserver(upstream, {
    capabilities: WEB_SESSION_CAPABILITIES,
    onUse: () => recorder.record({ type: "web_use", since: 400_000, via: "read" }),
    onLost: () => {
      const idle = recorder.idleMs("web");
      recorder.record({ type: "session_lost", session: "web" });
      return idle;
    },
  });
  await portal.getGrades();
  await portal.getScheduleWeek(2); // not a web-session capability: not a use
  assert.equal(historyStore.read()!.web!.activityCount, 1);

  now += 47 * MIN;
  upstream.failNext = new SessionLostError("right_student_absence.jsp", true);
  const lost = await portal.getUnreportedAbsence().catch((e: unknown) => e);
  assert.ok(lost instanceof SessionLostError && lost.web);
  assert.equal(lost.key, "web_session_lost_after");
  assert.match(
    describeError(lost, "en", "mcp").message,
    /expired after about 47 minutes without use/,
  );
  assert.match(
    describeError(lost, "sv", "cli").message,
    /gick ut efter ungefär 47 minuter utan användning/,
  );
  assert.match(describeError(lost, "sv", "cli").hint!, /login --web/);

  // Already recorded (or never tracked): the plain message, and the error is passed on as it is.
  const again = new SessionLostError("right_student_absence.jsp", true);
  upstream.failNext = again;
  assert.equal(await portal.getUnreportedAbsence().catch((e: unknown) => e), again);
  // Anything else passes through untouched: an app-session loss, a plain failure.
  const app = new SessionLostError("x.jsp");
  upstream.failNext = app;
  assert.equal(await portal.getGrades().catch((e: unknown) => e), app);
  upstream.failNext = new Error("boom");
  await assert.rejects(portal.getGrades(), /boom/);
  assert.equal(historyStore.read()!.losses.length, 1);
});

test("wiring: a gated read through the production portal records the use and the loss", async (t) => {
  const w = wired(t, { web: true });
  await w.manager.ensureSession();
  await w.portals.portal.getGradePrognosis();
  assert.equal(w.history.read()!.web!.activityCount, 1);
  assert.equal(w.history.read()!.web!.startedAt, 1_900_000_000_000 - 30 * MIN);
  w.advance(40 * MIN);
  // The web session reports another child, so the portal's own PUT follows, and that is refused.
  w.sim.webHeader = { status: 200, data: { currentChildId: 999, currentOrgId: 20 } };
  const put = w.sim.fetch;
  const lostOnPut = async (...a: Parameters<typeof put>) =>
    a[2].method === "PUT" ? { status: 401, data: "", headers: {}, setCookies: [] } : put(...a);
  const portals = createPortals(w.manager, { fetchImpl: lostOnPut, browser: null });
  await assert.rejects(
    portals.portal.getGradePrognosis(),
    /expired after about 40 minutes without use/,
  );
  assert.deepEqual(
    w.manager.sessionHistory()!.losses.map((l) => [l.session, l.idleMinutes, l.ageMinutes]),
    [["web", 40, 70]],
  );
});

test("auth_status reports the keepalive mode and the observed session history, logged in or not", async (t) => {
  const w = wired(t);
  const status = getOperation("auth_status")!;
  const inside = (await runOperation(status, w.ctx, {})) as {
    authenticated: boolean;
    keepalive: string;
    sessionHistory: { app: unknown; losses: unknown[] };
  };
  assert.deepEqual(
    [inside.authenticated, inside.keepalive, inside.sessionHistory.losses],
    [true, "off", []],
  );
  w.manager.logout();
  const outside = (await runOperation(status, w.ctx, {})) as typeof inside;
  assert.deepEqual([outside.authenticated, outside.keepalive], [false, "off"]);
  assert.equal(outside.sessionHistory.app, null);
  assert.match(status.description, /sessionHistory/);
});

test("doctor: shows what has been observed, never fails on it, and copes with an empty history", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ss-doctor-"));
  try {
    const deps = {
      getContext: () => {
        throw new Error("doctor never builds a context");
      },
      stdout: () => {},
      stderr: () => {},
      env: { SCHOOLSOFT_KEEPALIVE: "app" },
      home: dir,
      platform: "linux" as const,
      version: "0",
      fetchImpl: async () => ({ status: 200 }),
      browserProbes: {
        resolvePlaywright: () => {
          throw new Error("not installed");
        },
        chromiumPath: async () => "/nowhere/chromium",
      },
    };
    const overrides = { school: "taby", configDir: dir };
    const check = async (extra: object = {}) =>
      (await runDoctor({ ...deps, ...extra }, overrides, false, "v22.0.0")).checks.find(
        (c) => c.name === "session-history",
      )!;
    const empty = await check();
    assert.equal(empty.ok, true);
    assert.equal(
      empty.detail,
      "keepalive=app; no session loss observed yet (full record: schoolsoft-agent auth-status)",
    );

    let now = 1_000_000;
    const recorder = new SessionHistoryRecorder(
      new FileSessionHistoryStore(join(dir, "state")),
      () => now,
    );
    recorder.record({ type: "login" });
    recorder.record({ type: "web_use", since: 400_000, via: "read" });
    now += 50 * MIN;
    recorder.record({ type: "session_lost", session: "web" });
    recorder.record({ type: "web_use", since: now, via: "read" });
    now += 10 * MIN;
    const full = await check({ now: () => now });
    assert.equal(
      full.detail,
      "keepalive=app; app login 60 min old, 0 refreshes, longest gap survived 0 min; " +
        "web login 10 min old, idle 10 min, longest gap survived 0 min; " +
        "1 observed losses, last: web session at 1970-01-01T01:06:40.000Z after 60 min (idle 50 min)" +
        " (full record: schoolsoft-agent auth-status)",
    );

    // Sessions that predate the history have no known age.
    const old = mkdtempSync(join(tmpdir(), "ss-doctor-old-"));
    const r2 = new SessionHistoryRecorder(new FileSessionHistoryStore(join(old, "state")), () => 5);
    r2.record({ type: "refresh" });
    r2.record({ type: "session_lost", session: "app" });
    r2.record({ type: "refresh" });
    const unknown = (
      await runDoctor({ ...deps, home: old }, { school: "taby", configDir: old }, false, "v22.0.0")
    ).checks.find((c) => c.name === "session-history")!;
    assert.match(unknown.detail, /app login \? min old, 1 refreshes/);
    assert.match(unknown.detail, /after \? min \(idle 0 min\)/);
    rmSync(old, { recursive: true, force: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("owner page: sign-in history in plain words, escaped, and absent until something is known", () => {
  assert.equal(signInHistory(undefined), "");
  assert.equal(signInHistory(null), "");
  assert.equal(signInHistory({ recordedSince: null, app: null, web: null, losses: [] }), "");
  const span = {
    since: "2026-09-01T06:00:00.000Z",
    ageMinutes: 90,
    lastActivity: "2026-09-01T07:20:00.000Z",
    idleMinutes: 10,
    activityCount: 7,
    longestGapSurvivedMinutes: 12,
  };
  const loss = {
    session: "app" as const,
    at: "2026-09-20T06:30:00.000Z",
    ageMinutes: 43_200 as number | null,
    idleMinutes: 600,
    activityCount: 3,
    longestGapSurvivedMinutes: 480,
  };
  const html = signInHistory({ recordedSince: span.since, app: span, web: null, losses: [loss] });
  assert.match(html, /<h2>Sign-in history<\/h2>/);
  assert.match(html, /Current sign-in: 90 minutes old, renewed 7 times\./);
  assert.match(
    html,
    /2026-09-20 06:30 UTC: SchoolSoft ended a sign-in after 43200 minutes \(600 minutes since/,
  );
  const unknown = signInHistory({
    recordedSince: null,
    app: { ...span, since: null, ageMinutes: null },
    web: null,
    losses: [{ ...loss, ageMinutes: null }],
  });
  assert.match(unknown, /started before this was recorded/);
  assert.match(unknown, /after an unknown time/);
  assert.match(
    signInHistory({ recordedSince: null, app: null, web: null, losses: [loss] }),
    /ended a sign-in/,
  );
});

test("connector start: keepalive and cache settings come from the deployment environment; the history is encrypted at rest", async (t) => {
  t.mock.method(SchoolsoftClient.prototype, "verifySession", async () => true);
  const dir = mkdtempSync(join(tmpdir(), "ss-connector-"));
  const probe = createServer().listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address() as AddressInfo;
  await new Promise((r) => probe.close(r));
  const env = {
    SCHOOLSOFT_PUBLIC_URL: "https://parent.example",
    SCHOOLSOFT_ADMIN_PASSWORD: "synthetic-admin-password-0123456789",
    SCHOOLSOFT_STORAGE_KEY: "ab".repeat(32),
    SCHOOLSOFT_SCHOOL: "taby",
    SCHOOLSOFT_STATE_DIR: dir,
    PORT: String(port),
  };
  try {
    assert.throws(
      () => startConnector({ ...env, SCHOOLSOFT_KEEPALIVE: "forever" }),
      ConfigValueError,
      "a bad value stops the start before anything listens",
    );
    const timer = new FakeTimer();
    const sim = new SchoolsoftSim(timer.now);
    const started = startConnector(
      {
        ...env,
        SCHOOLSOFT_KEEPALIVE: "app",
        SCHOOLSOFT_KEEPALIVE_QUIET_HOURS: "",
        SCHOOLSOFT_CACHE: "off",
      },
      { fetchImpl: sim.fetch, now: timer.now },
      { timer, random: () => 0 },
    );
    try {
      assert.equal(timer.pending.size, 1, "keepalive was started with the deployment's setting");
      await started.runtime.logout(); // writes a history event through the encrypted repository
      const files = readdirSync(dir);
      const historyFile = files.find((f) => f.startsWith("history"));
      assert.ok(historyFile, `history file among ${files.join(", ")}`);
      assert.doesNotMatch(
        readFileSync(join(dir, historyFile), "utf8"),
        /logout|events/,
        "ciphertext",
      );
      assert.equal((await started.runtime.status()).sessionHistory?.recordedSince !== null, true);
    } finally {
      await started.runtime.close();
      await new Promise((r) => started.server.close(r));
    }
    const plain = startConnector(env);
    try {
      assert.equal(
        (await plain.runtime.status()).sessionHistory?.recordedSince !== null,
        true,
        "history survives a restart",
      );
    } finally {
      await plain.runtime.close();
      await new Promise((r) => plain.server.close(r));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
