/**
 * Keepalive: the scheduler on its own (injected timer, clock, randomness),
 * then through the production wiring against the offline SchoolSoft stand-in.
 * It must refresh before expiry, touch the web session with a GET only, back
 * off on transient failures, stop for good on session loss and never log in.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AgentError,
  InputError,
  KeepaliveScheduler,
  MAX_BACKOFF_MS,
  MIN_DELAY_MS,
  MemoryPendingLoginStore,
  MemorySessionHistoryStore,
  MemorySessionStore,
  NetworkError,
  NotAuthenticatedError,
  NotConfiguredError,
  UpstreamError,
  createKeepalive,
  createRequestBudget,
  createSessionManager,
  inQuietHours,
  resolveConfig,
  type KeepaliveTask,
  type OperationContext,
} from "../../src/core/index.js";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { startMcpKeepalive } from "../../src/mcp/keepalive.js";
import { FakeTimer } from "../helpers/fake-timer.js";
import { idleTimer } from "../helpers/budget.js";
import { SchoolsoftSim, savedSession } from "../helpers/schoolsoft-sim.js";
import { makeContext } from "../helpers/fakes.js";

const MIN = 60_000;

function scheduler(
  tasks: KeepaliveTask[],
  o: { random?: number; quiet?: { startHour: number; endHour: number }; hour?: () => number } = {},
) {
  const timer = new FakeTimer();
  const logs: string[] = [];
  const s = new KeepaliveScheduler({
    tasks,
    timer,
    now: timer.now,
    random: () => o.random ?? 0,
    quietHours: o.quiet,
    hourOf: o.hour ? () => o.hour!() : undefined,
    log: (m) => logs.push(m),
  });
  return { s, timer, logs };
}

function task(name: "app" | "web", run: () => Promise<number | null>, extra = {}): KeepaliveTask {
  return { name, intervalMs: 10 * MIN, run, ...extra };
}

test("runs on its interval, uses the delay a task asks for, never sooner than the floor, and only ever early", async () => {
  let wanted: number | null = null;
  let runs = 0;
  const { s, timer } = scheduler(
    [
      task("app", async () => {
        runs++;
        return wanted;
      }),
    ],
    { random: 0.5 },
  );
  assert.deepEqual(s.status(), { app: "stopped" });
  s.start();
  assert.deepEqual(s.status(), { app: "scheduled" });
  assert.deepEqual(timer.delays, [9.5 * MIN], "jitter: up to 10% early, never late");
  await timer.fire();
  assert.equal(runs, 1);
  wanted = 12 * MIN;
  await timer.fire();
  wanted = 5;
  await timer.fire();
  assert.deepEqual(timer.delays, [9.5 * MIN, 9.5 * MIN, 11.4 * MIN, MIN_DELAY_MS]);
  s.stop();
  assert.equal(timer.pending.size, 0);
  assert.deepEqual(s.status(), { app: "stopped" });
});

test("firstDelayMs schedules the first run soon after start; resume of an unknown task is a no-op", () => {
  const { s, timer } = scheduler([task("app", async () => null, { firstDelayMs: MIN })]);
  s.start();
  assert.deepEqual(timer.delays, [MIN]);
  s.resume("web");
  assert.deepEqual(s.status(), { app: "scheduled" });
});

test("transient failures back off exponentially up to the cap, and a success resets it", async () => {
  let fail: Error | null = new NetworkError("ENOTFOUND");
  const { s, timer } = scheduler([
    task("web", async () => {
      if (fail) throw fail;
      return null;
    }),
  ]);
  s.start();
  for (let i = 0; i < 4; i++) await timer.fire();
  fail = new UpstreamError(503, "header");
  await timer.fire();
  assert.deepEqual(timer.delays.slice(1), [
    20 * MIN,
    40 * MIN,
    MAX_BACKOFF_MS,
    MAX_BACKOFF_MS,
    MAX_BACKOFF_MS,
  ]);
  fail = null;
  await timer.fire();
  assert.equal(timer.delays.at(-1), 10 * MIN);
  assert.deepEqual(s.status(), { web: "scheduled" });
});

test("session loss is a hard stop: no retry, no loop, until resume", async () => {
  let runs = 0;
  const lost = new NotAuthenticatedError("renewal failed");
  const { s, timer, logs } = scheduler([
    task("app", async () => {
      runs++;
      throw lost;
    }),
    task("web", async () => null),
  ]);
  s.start();
  await timer.fire();
  assert.deepEqual(s.status(), { app: "stopped", web: "scheduled" }, "the other task carries on");
  assert.deepEqual(logs, ["keepalive: app stopped (not_authenticated)"]);
  await timer.fire(); // web
  await timer.fire(); // web again
  assert.equal(runs, 1, "the dead session was tried exactly once");
  s.resume("app"); // a human logged in again
  assert.deepEqual(s.status(), { app: "scheduled", web: "scheduled" });
});

test("anything unexpected also stops the task: a bug must not become a request loop", async () => {
  const { s, timer, logs } = scheduler([
    task("app", async () => {
      throw new TypeError("bug");
    }),
  ]);
  s.start();
  await timer.fire();
  assert.deepEqual(s.status(), { app: "stopped" });
  assert.deepEqual(logs, ["keepalive: app stopped (unexpected error)"]);
  assert.equal(timer.pending.size, 0);
  const upstream4xx = scheduler([
    task("web", async () => {
      throw new UpstreamError(404, "header");
    }),
  ]);
  upstream4xx.s.start();
  await upstream4xx.timer.fire();
  assert.deepEqual(upstream4xx.s.status(), { web: "stopped" }, "a 4xx is not worth retrying");
});

test("quiet hours: no request is made, the check simply comes back later", async () => {
  let hour = 23;
  let runs = 0;
  const { s, timer } = scheduler(
    [
      task("web", async () => {
        runs++;
        return null;
      }),
    ],
    { quiet: { startHour: 22, endHour: 6 }, hour: () => hour },
  );
  s.start();
  await timer.fire();
  await timer.fire();
  assert.equal(runs, 0);
  hour = 6;
  await timer.fire();
  assert.equal(runs, 1);
  assert.deepEqual(
    [21, 22, 23, 0, 5, 6].map((h) => inQuietHours(h, { startHour: 22, endHour: 6 })),
    [false, true, true, true, true, false],
  );
  assert.deepEqual(
    [12, 13, 14, 15].map((h) => inQuietHours(h, { startHour: 13, endHour: 15 })),
    [false, true, true, false],
  );
});

test("the default hour comes from the local clock", async () => {
  const timer = new FakeTimer();
  const hour = new Date(timer.t + 10 * MIN).getHours();
  let runs = 0;
  const s = new KeepaliveScheduler({
    tasks: [
      task("app", async () => {
        runs++;
        return null;
      }),
    ],
    timer,
    now: timer.now,
    random: () => 0,
    quietHours: { startHour: hour, endHour: (hour + 1) % 24 },
  });
  s.start();
  await timer.fire();
  assert.equal(runs, 0);
});

test("a run that finishes after stop or resume neither re-arms nor reports", async () => {
  let release!: (v: number | null) => void;
  let reject!: (e: Error) => void;
  const { s, timer, logs } = scheduler([
    task(
      "app",
      () =>
        new Promise<number | null>((res, rej) => {
          release = res;
          reject = rej;
        }),
    ),
  ]);
  s.start();
  const firing = timer.fire();
  s.stop();
  release(null);
  await firing;
  assert.equal(timer.pending.size, 0, "stopped stays stopped");
  s.start();
  const second = timer.fire();
  s.resume("app"); // e.g. a login while the old run is still in flight
  reject(new NotAuthenticatedError("late"));
  await second;
  assert.deepEqual(s.status(), { app: "scheduled" });
  assert.equal(timer.pending.size, 1, "exactly the timer from resume");
  assert.deepEqual(logs, []);
});

// ---------------------------------------------------------------- wiring

function wired(
  t: { mock: { method: typeof import("node:test").mock.method } },
  o: { mode: "off" | "app" | "all"; quietHours?: string; web?: boolean; ttlSeconds?: number },
) {
  const timer = new FakeTimer();
  const sim = new SchoolsoftSim(timer.now);
  const store = new MemorySessionStore();
  const history = new MemorySessionHistoryStore();
  store.save({
    ...savedSession(timer.t, o.ttlSeconds),
    web: o.web
      ? {
          savedAt: timer.t - 5 * MIN,
          landedOn: "https://sms.schoolsoft.se/taby/x",
          cookies: [{ name: "JSESSIONID", value: "web", domain: "sms.schoolsoft.se", path: "/" }],
        }
      : undefined,
  });
  const config = resolveConfig(
    [
      {
        school: "taby",
        configDir: "/nowhere",
        keepalive: o.mode,
        keepaliveQuietHours: o.quietHours,
      },
    ],
    { home: "/unused", platform: "linux" },
  );
  let webLogins = 0;
  const manager = createSessionManager(config, {
    store,
    history,
    now: timer.now,
    // The budget on the same fake clock; keepalive requests are background and never wait on its timer.
    budget: createRequestBudget(config, { now: timer.now, timer: idleTimer }),
    fetchImpl: sim.fetch,
    pending: new MemoryPendingLoginStore(),
    openBrowser: () => {
      throw new Error("keepalive must never open a browser");
    },
    webLogin: async () => {
      webLogins++;
      return { savedAt: timer.t, landedOn: "https://sms.schoolsoft.se/taby/y", cookies: [] };
    },
  });
  const logs: string[] = [];
  const keepalive = createKeepalive(config, manager, {
    timer,
    now: timer.now,
    random: () => 0,
    hourOf: () => 12,
    fetchImpl: sim.fetch,
    log: (m) => logs.push(m),
  });
  return {
    timer,
    sim,
    store,
    history,
    manager,
    keepalive,
    logs,
    config,
    webLogins: () => webLogins,
  };
}

test("off by default: no scheduler, no timer, no request", (t) => {
  const w = wired(t, { mode: "off" });
  assert.equal(w.config.keepalive.mode, "off");
  assert.equal(
    resolveConfig([{ school: "s" }], { home: "/h", platform: "linux" }).keepalive.mode,
    "off",
  );
  assert.equal(w.keepalive, null);
  assert.equal(w.timer.pending.size, 0);
  assert.deepEqual(w.sim.requests, []);
});

test("app mode: refreshes before expiry, persists the rotated pair at once, records it, and schedules from the new expiry", async (t) => {
  const w = wired(t, { mode: "app", ttlSeconds: 120 }); // expires in 2 min: inside the 3 min lead
  w.keepalive!.start();
  assert.deepEqual(w.keepalive!.status(), { app: "scheduled" }, "no web task in app mode");
  assert.deepEqual(w.timer.delays, [MIN], "first check a minute after start");
  await w.timer.fire();
  assert.deepEqual(w.sim.requests, [
    "POST /taby/rest-api/login/token?clientId=vApp&grantType=refresh_token&refreshToken=refresh-0",
  ]);
  assert.equal((w.store.load()!.data as { refreshToken: string }).refreshToken, "refresh-1");
  assert.equal(w.history.read()!.app!.activityCount, 1);
  assert.equal(w.timer.delays.at(-1), 12 * MIN, "15 min token minus the 3 min lead");
  await w.timer.fire();
  assert.equal(w.sim.refreshes, 2);
  assert.ok(w.sim.requests.every((r) => r.startsWith("POST /taby/rest-api/login/token")));
});

test("app mode: a token another process already refreshed is adopted, not refreshed again", async (t) => {
  const w = wired(t, { mode: "app", ttlSeconds: 900 });
  w.keepalive!.start();
  await w.timer.fire();
  assert.deepEqual(w.sim.requests, []);
  assert.equal(w.timer.delays.at(-1), 11 * MIN, "14 min left minus the lead");
});

test("app mode: network trouble backs off and keeps the session; a rejected refresh is a recorded loss and a hard stop", async (t) => {
  const w = wired(t, { mode: "app", ttlSeconds: 60 });
  w.keepalive!.start();
  await w.timer.fire(); // one good refresh, so the history knows this session
  w.timer.t += 13 * MIN; // and the next check finds the token near expiry again
  w.sim.failWith = Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
  await w.timer.fire();
  assert.equal(w.timer.delays.at(-1), 20 * MIN);
  assert.notEqual(w.store.load(), null, "a wifi blip never costs a BankID login");
  w.sim.failWith = null;
  w.sim.refreshStatus = 503;
  await w.timer.fire();
  assert.equal(w.timer.delays.at(-1), 40 * MIN);
  assert.notEqual(w.store.load(), null);
  w.sim.refreshStatus = 400;
  await w.timer.fire();
  assert.equal(w.store.load(), null);
  assert.deepEqual(w.keepalive!.status(), { app: "stopped" });
  assert.equal(w.timer.pending.size, 0, "nothing scheduled: it cannot loop against a dead session");
  assert.deepEqual(w.logs, ["keepalive: app stopped (not_authenticated)"]);
  const [loss] = w.history.read()!.losses;
  assert.deepEqual([loss.session, loss.activityCount], ["app", 1]);
  assert.ok(loss.idleMs >= 13 * MIN, "idle time counts from the last successful refresh");
  assert.ok(
    w.sim.requests.every((r) => r.includes("/login/token")),
    "keepalive only ever spoke to the token endpoint: no login page, no BankID",
  );
});

test("all mode: the web touch is one GET of the portal's own header, recorded as a use; it never writes or switches child", async (t) => {
  const w = wired(t, { mode: "all", web: true });
  w.keepalive!.start();
  assert.deepEqual(w.keepalive!.status(), { app: "scheduled", web: "scheduled" });
  await w.timer.fire(); // app: token still valid
  await w.timer.fire(); // web
  assert.deepEqual(w.sim.requests, ["GET /taby/rest-api/parent/header/parent"]);
  const web = w.history.read()!.web!;
  assert.deepEqual([web.startedAt, web.activityCount], [w.timer.t - 5 * MIN - 2 * MIN, 1]);
  assert.equal(w.timer.delays.at(-1), 10 * MIN);
  for (let i = 0; i < 6; i++) await w.timer.fire();
  assert.ok(
    w.sim.requests.every(
      (r) => r.startsWith("GET ") || r.startsWith("POST /taby/rest-api/login/token"),
    ),
    "the web session only ever sees GETs from keepalive",
  );
  assert.ok(!w.sim.requests.some((r) => r.startsWith("PUT")));
});

test("all mode: a dead web session (401, or a login page instead of the header) is recorded and stops the web task only", async (t) => {
  for (const dead of [
    { status: 401, data: null },
    { status: 200, data: "<html>Logga in</html>" },
    { status: 200, data: null },
  ]) {
    const w = wired(t, { mode: "all", web: true });
    w.keepalive!.start();
    await w.timer.fire(); // app
    await w.timer.fire(); // web, alive
    w.sim.webHeader = dead;
    await w.timer.fire(); // app
    await w.timer.fire(); // web, dead
    assert.deepEqual(w.keepalive!.status(), { app: "scheduled", web: "stopped" });
    const [loss] = w.history.read()!.losses;
    assert.equal(loss.session, "web");
    assert.ok(loss.idleMs >= 10 * MIN, "idle since the last successful touch");
    assert.deepEqual(w.logs, ["keepalive: web stopped (web_session_lost)"]);
    const touches = () => w.sim.requests.filter((r) => r.includes("/header/parent")).length;
    const before = touches();
    for (let i = 0; i < 3; i++) await w.timer.fire();
    assert.equal(touches(), before, "no further touches");
    assert.equal(w.webLogins(), 0, "and never a login on its own");
    // Only the user's next web login starts it again.
    await w.manager.webLogin();
    assert.deepEqual(w.keepalive!.status(), { app: "scheduled", web: "scheduled" });
  }
});

test("all mode: a struggling server is retried with backoff; without a web session the web task stops at once", async (t) => {
  const w = wired(t, { mode: "all", web: true });
  w.keepalive!.start();
  await w.timer.fire(); // app
  w.sim.webHeader = { status: 502, data: null };
  await w.timer.fire(); // web
  assert.deepEqual(w.keepalive!.status(), { app: "scheduled", web: "scheduled" });
  assert.equal(w.timer.delays.at(-1), 20 * MIN);
  assert.deepEqual(w.history.read()?.losses ?? [], []);

  const none = wired(t, { mode: "all", web: false });
  none.keepalive!.start();
  await none.timer.fire();
  await none.timer.fire();
  assert.deepEqual(none.keepalive!.status(), { app: "scheduled", web: "stopped" });
  assert.deepEqual(none.logs, ["keepalive: web stopped (web_login_required)"]);
  assert.deepEqual(none.sim.requests, [], "nothing was sent");
});

test("logout stops everything; nothing saved stops the app task; quiet hours from config reach the scheduler", async (t) => {
  const w = wired(t, { mode: "all", web: true });
  w.keepalive!.start();
  w.manager.logout();
  assert.deepEqual(w.keepalive!.status(), { app: "stopped", web: "stopped" });
  assert.equal(w.timer.pending.size, 0);

  const empty = wired(t, { mode: "app" });
  empty.store.clear();
  empty.keepalive!.start();
  await empty.timer.fire();
  assert.deepEqual(empty.keepalive!.status(), { app: "stopped" });
  assert.deepEqual(empty.sim.requests, []);
  assert.deepEqual(empty.history.read(), null, "not being logged in is not a session loss");

  const quiet = wired(t, { mode: "app", quietHours: "11-13", ttlSeconds: 1 }); // hourOf is 12
  quiet.keepalive!.start();
  await quiet.timer.fire();
  assert.deepEqual(quiet.sim.requests, []);
});

test("production defaults: an unref'd real timer and Math.random, started and stopped without a request", () => {
  const config = resolveConfig([{ school: "taby", keepalive: "all" }], {
    home: "/unused",
    platform: "linux",
  });
  const manager = createSessionManager(config, {
    store: new MemorySessionStore(),
    history: new MemorySessionHistoryStore(),
    pending: new MemoryPendingLoginStore(),
  });
  const keepalive = createKeepalive(config, manager)!;
  keepalive.start();
  assert.deepEqual(keepalive.status(), { app: "scheduled", web: "scheduled" });
  keepalive.stop();
  assert.deepEqual(keepalive.status(), { app: "stopped", web: "stopped" });
});

test("a host queue wraps every tick (the connector serialises keepalive with its reads)", async () => {
  const timer = new FakeTimer();
  const sim = new SchoolsoftSim(timer.now);
  const store = new MemorySessionStore();
  store.save(savedSession(timer.t, 30));
  const config = resolveConfig([{ school: "taby", keepalive: "app" }], {
    home: "/unused",
    platform: "linux",
  });
  const manager = createSessionManager(config, {
    store,
    history: new MemorySessionHistoryStore(),
    now: timer.now,
    fetchImpl: sim.fetch,
  });
  let wrapped = 0;
  const keepalive = createKeepalive(config, manager, {
    timer,
    now: timer.now,
    random: () => 0,
    wrap: async (run) => {
      wrapped++;
      return run();
    },
  })!;
  keepalive.start();
  await timer.fire();
  assert.deepEqual([wrapped, sim.refreshes], [1, 1]);
});

// ------------------------------------------------------------- MCP entry

test("MCP server: starts keepalive only when configured on; an unconfigured server still starts; bugs are not swallowed", async () => {
  const timer = new FakeTimer();
  const off = makeContext();
  assert.equal(
    startMcpKeepalive(() => off.ctx, { timer }),
    null,
  );
  assert.equal(timer.pending.size, 0);

  const on = makeContext({
    config: { keepalive: { mode: "app", webIntervalMs: 10 * MIN, quietHours: null } },
  });
  const started = startMcpKeepalive(() => on.ctx, { timer, random: () => 0 });
  assert.deepEqual(started?.status(), { app: "scheduled" });
  await on.manager.login();
  await timer.fire();
  assert.equal(on.strategy.renewCalls, 1);
  assert.equal(
    timer.delays.at(-1),
    10 * MIN,
    "a provider that reports no expiry is checked on the interval",
  );
  started?.stop();

  const unconfigured = (): OperationContext => {
    throw new NotConfiguredError("no school slug");
  };
  assert.equal(startMcpKeepalive(unconfigured, { timer }), null);
  assert.throws(
    () =>
      startMcpKeepalive(() => {
        throw new TypeError("bug");
      }),
    TypeError,
  );
  assert.ok(new InputError("x") instanceof AgentError);
});

test("the one-shot CLI and the shared bootstrap never create a keepalive; the two long-lived hosts do", () => {
  const sources = (dir: string): string[] =>
    readdirSync(join(process.cwd(), dir), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? sources(join(dir, e.name))
        : e.name.endsWith(".ts")
          ? [join(dir, e.name)]
          : [],
    );
  const starts = (file: string) =>
    /createKeepalive|startMcpKeepalive|KeepaliveScheduler/.test(
      readFileSync(join(process.cwd(), file), "utf8"),
    );
  assert.deepEqual([...sources("src/cli"), ...sources("src/shared")].filter(starts), []);
  assert.deepEqual([...sources("src/mcp"), ...sources("src/http")].filter(starts).sort(), [
    "src/http/runtime.ts",
    "src/mcp/index.ts",
    "src/mcp/keepalive.ts",
  ]);
});
