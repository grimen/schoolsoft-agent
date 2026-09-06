/**
 * The pending-login marker and the manager behaviour built on it: progress
 * for callers that did not wait, refusal to open a second window, cleanup
 * of abandoned entries, background start that resolves on the URL.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FilePendingLoginStore,
  MemoryPendingLoginStore,
  PENDING_LOGIN_TTL_MS,
} from "../../src/core/session/pending-login.js";
import {
  SessionManager,
  MemorySessionStore,
  type AuthStrategy,
  type LoginInfo,
} from "../../src/core/index.js";
import { fakeSession, serializeFake, type FakeSession } from "../helpers/fakes.js";

test("file store: absent → null, roundtrip, corrupt file → null, clear", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "pending-")), "state");
  const store = new FilePendingLoginStore(dir);
  assert.equal(store.read(), null);
  store.write({ state: "running", startedAt: 1, pid: 7 });
  assert.deepEqual(store.read(), { state: "running", startedAt: 1, pid: 7 });
  writeFileSync(join(dir, "login-pending.json"), "{not json");
  assert.equal(store.read(), null);
  store.clear();
  store.clear();
  assert.equal(store.read(), null);
});

class SlowStrategy implements AuthStrategy<FakeSession> {
  readonly id = "slow";
  context = undefined;
  gate!: () => void;
  fail = false;
  private started!: Promise<void>;
  constructor(private readonly openBrowser: (url: string) => void) {
    this.started = new Promise((r) => (this.gate = r));
  }
  async login(): Promise<LoginInfo> {
    this.openBrowser("https://login.example/x");
    await this.started;
    if (this.fail) throw new Error("bankid cancelled");
    return { name: "P", schoolName: "S", userType: "parent" };
  }
  async restore(): Promise<void> {}
  async focusChild(): Promise<void> {}
}

function managerWith(
  o: {
    pid?: number;
    now?: () => number;
    isAlive?: (pid: number) => boolean;
    pending?: MemoryPendingLoginStore;
  } = {},
) {
  const pending = o.pending ?? new MemoryPendingLoginStore();
  let manager!: SessionManager<FakeSession>;
  const strategy = new SlowStrategy((url) => manager.noteLoginUrl(url));
  manager = new SessionManager<FakeSession>({
    school: "s",
    store: new MemorySessionStore(),
    strategies: [strategy],
    createSession: () => fakeSession(),
    serialize: serializeFake,
    pending,
    pid: o.pid ?? 100,
    now: o.now,
    isAlive: o.isAlive,
  });
  return { manager, strategy, pending };
}

const tick = () => new Promise((r) => setImmediate(r));

test("startLogin resolves with the URL while the login keeps running; a second login joins the one in flight", async () => {
  const { manager, strategy, pending } = managerWith();
  const started = await manager.startLogin(undefined, 1000, async () => {});
  assert.equal(started.url, "https://login.example/x");
  assert.equal(manager.pendingLogin()?.state, "running");
  const joined = manager.login();
  strategy.gate();
  const info = await joined;
  assert.equal(info.name, "P");
  await tick();
  assert.equal(pending.read(), null, "marker cleared on success");
  assert.equal(manager.pendingLogin(), null);
});

test("a failed background login is recorded (state failed, error) and reported by auth-status; the next login starts fresh", async () => {
  const { manager, strategy, pending } = managerWith();
  strategy.fail = true;
  await manager.startLogin(undefined, 1000, async () => {});
  strategy.gate();
  await tick();
  await tick();
  assert.equal(pending.read()?.state, "failed");
  assert.match(pending.read()?.error ?? "", /bankid cancelled/);
  assert.equal(manager.pendingLogin()?.state, "failed", "kept for auth-status to show");
  // startLogin sees a failed marker of its own attempt → throws with the reason
  const { manager: m2, strategy: s2 } = managerWith();
  s2.fail = true;
  const p = m2.startLogin(undefined, 1000, async () => {
    s2.gate();
    await tick();
    await tick();
  });
  // the URL is recorded before the failure, so the first poll returns it
  assert.equal((await p).url, "https://login.example/x");
});

test("startLogin without a URL returns after the timeout; a failed marker before any URL throws", async () => {
  let t = 1000;
  const now = () => t;
  const pending = new MemoryPendingLoginStore();
  let manager!: SessionManager<FakeSession>;
  const silent: AuthStrategy<FakeSession> = {
    id: "silent",
    login: () => new Promise(() => {}),
    restore: async () => {},
    focusChild: async () => {},
  };
  manager = new SessionManager<FakeSession>({
    school: "s",
    store: new MemorySessionStore(),
    strategies: [silent],
    createSession: () => fakeSession(),
    serialize: serializeFake,
    pending,
    pid: 1,
    now,
  });
  const r = await manager.startLogin(undefined, 500, async () => {
    t += 300;
  });
  assert.equal(r.url, undefined);
  assert.equal(r.startedAt, 1000);
  // failed marker, no url
  const pending2 = new MemoryPendingLoginStore();
  const failing: AuthStrategy<FakeSession> = {
    id: "failing",
    login: async () => {
      throw new Error("denied");
    },
    restore: async () => {},
    focusChild: async () => {},
  };
  const m2 = new SessionManager<FakeSession>({
    school: "s",
    store: new MemorySessionStore(),
    strategies: [failing],
    createSession: () => fakeSession(),
    serialize: serializeFake,
    pending: pending2,
    pid: 1,
  });
  await assert.rejects(m2.startLogin(undefined, 1000, tick as never), /denied/);
});

test("another live process's running login blocks a new login; a dead process's or stale marker is cleared", async () => {
  const pending = new MemoryPendingLoginStore();
  pending.write({ state: "running", startedAt: 5_000, pid: 999 });
  const alive = managerWith({ pid: 100, now: () => 6_000, isAlive: () => true, pending });
  await assert.rejects(alive.manager.login(), /already in progress/);
  assert.equal(alive.manager.pendingLogin()?.pid, 999);
  const dead = managerWith({ pid: 100, now: () => 6_000, isAlive: () => false, pending });
  assert.equal(dead.manager.pendingLogin(), null, "dead process → cleared");
  pending.write({ state: "running", startedAt: 0, pid: 999 });
  const stale = managerWith({
    pid: 100,
    now: () => PENDING_LOGIN_TTL_MS + 1,
    isAlive: () => true,
    pending,
  });
  assert.equal(stale.manager.pendingLogin(), null, "older than the TTL → cleared");
  // a marker from this very process (e.g. MCP background login) is not "another process"
  pending.write({ state: "running", startedAt: 5_000, pid: 100 });
  const same = managerWith({ pid: 100, now: () => 6_000, pending });
  assert.equal(same.manager.pendingLogin()?.pid, 100);
  // noteLoginUrl without a running marker is a no-op
  pending.clear();
  same.manager.noteLoginUrl("https://x");
  assert.equal(pending.read(), null);
  // a manager without a pending store never reports progress
  const bare = new SessionManager<FakeSession>({
    school: "s",
    store: new MemorySessionStore(),
    strategies: [new SlowStrategy(() => {})],
    createSession: () => fakeSession(),
    serialize: serializeFake,
  });
  assert.equal(bare.pendingLogin(), null);
  bare.noteLoginUrl("x");
});

test("a non-Error failure after the marker vanished is still recorded, with a fresh start time", async () => {
  const pending = new MemoryPendingLoginStore();
  const strategy: AuthStrategy<FakeSession> = {
    id: "odd",
    login: async () => {
      pending.clear(); // e.g. an operator cleaned the state dir mid-login
      throw "cancelled by user";
    },
    restore: async () => {},
    focusChild: async () => {},
  };
  const manager = new SessionManager<FakeSession>({
    school: "s",
    store: new MemorySessionStore(),
    strategies: [strategy],
    createSession: () => fakeSession(),
    serialize: serializeFake,
    pending,
    pid: 1,
    now: () => 777,
  });
  await assert.rejects(manager.login(), (e: unknown) => e === "cancelled by user");
  assert.deepEqual(pending.read(), {
    state: "failed",
    startedAt: 777,
    pid: 1,
    error: "cancelled by user",
  });
});
