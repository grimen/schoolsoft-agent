/**
 * Unit tests for SessionManager using injected fakes — no disk, no
 * network, no real SchoolsoftClient. Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SchoolsoftClient } from "@elias4044/ssp-node";
import {
  SessionManager,
  NotAuthenticatedError,
} from "../src/services/session-manager.js";
import { MemorySessionStore } from "../src/services/store.js";
import type { AuthStrategy, LoginInfo } from "../src/auth/strategy.js";
import type { PersistedSession } from "../src/services/store.js";

function fakeClient(overrides: Partial<SchoolsoftClient> = {}): SchoolsoftClient {
  return {
    school: "testskola",
    accessToken: "tok",
    refreshToken: "ref",
    verifySession: async () => true,
    ...overrides,
  } as unknown as SchoolsoftClient;
}

class FakeStrategy implements AuthStrategy {
  readonly id = "fake";
  loginCalls = 0;
  restoreCalls = 0;
  restoreShouldFail = false;

  async login(_client: SchoolsoftClient): Promise<LoginInfo> {
    this.loginCalls++;
    return { name: "Test Testsson", schoolName: "Testskolan", userType: "2" };
  }

  async restore(
    _client: SchoolsoftClient,
    _saved: PersistedSession,
  ): Promise<void> {
    this.restoreCalls++;
    if (this.restoreShouldFail) throw new Error("boom");
  }
}

function makeManager(opts: {
  store?: MemorySessionStore;
  strategy?: FakeStrategy;
  client?: SchoolsoftClient;
} = {}) {
  const store = opts.store ?? new MemorySessionStore();
  const strategy = opts.strategy ?? new FakeStrategy();
  const manager = new SessionManager({
    school: "testskola",
    store,
    strategies: [strategy],
    clientFactory: () => opts.client ?? fakeClient(),
  });
  return { manager, store, strategy };
}

test("ensureSession throws NotAuthenticatedError when nothing is saved", async () => {
  const { manager } = makeManager();
  await assert.rejects(() => manager.ensureSession(), NotAuthenticatedError);
});

test("login persists session and subsequent ensureSession reuses it", async () => {
  const { manager, store, strategy } = makeManager();
  const info = await manager.login();
  assert.equal(info.name, "Test Testsson");
  assert.equal(store.load()?.authMethod, "fake");

  await manager.ensureSession();
  assert.equal(strategy.loginCalls, 1);
  assert.equal(strategy.restoreCalls, 0, "live session should not re-restore");
});

test("ensureSession restores from store via the saving strategy", async () => {
  const store = new MemorySessionStore();
  store.save({
    school: "testskola",
    accessToken: "tok",
    savedAt: Date.now(),
    authMethod: "fake",
  });
  const { manager, strategy } = makeManager({ store });
  await manager.ensureSession();
  assert.equal(strategy.restoreCalls, 1);
});

test("failed restore clears the store and throws NotAuthenticatedError", async () => {
  const store = new MemorySessionStore();
  store.save({
    school: "testskola",
    accessToken: "tok",
    savedAt: Date.now(),
    authMethod: "fake",
  });
  const strategy = new FakeStrategy();
  strategy.restoreShouldFail = true;
  const { manager } = makeManager({ store, strategy });

  await assert.rejects(() => manager.ensureSession(), NotAuthenticatedError);
  assert.equal(store.load(), null, "store should be cleared after failure");
});

test("session saved for another school is rejected and cleared", async () => {
  const store = new MemorySessionStore();
  store.save({
    school: "annanskola",
    accessToken: "tok",
    savedAt: Date.now(),
    authMethod: "fake",
  });
  const { manager } = makeManager({ store });
  await assert.rejects(() => manager.ensureSession(), NotAuthenticatedError);
  assert.equal(store.load(), null);
});

test("dead session (verifySession false) throws and clears", async () => {
  const store = new MemorySessionStore();
  store.save({
    school: "testskola",
    accessToken: "tok",
    savedAt: Date.now(),
    authMethod: "fake",
  });
  const client = fakeClient({ verifySession: async () => false } as Partial<SchoolsoftClient>);
  const { manager } = makeManager({ store, client });
  await assert.rejects(() => manager.ensureSession(), NotAuthenticatedError);
  assert.equal(store.load(), null);
});
