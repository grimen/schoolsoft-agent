/**
 * Unit tests for SessionManager using injected fakes — no disk, no
 * network, no real SchoolsoftClient. Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionManager, NotAuthenticatedError } from "../../src/core/session/session-manager.js";
import { MemorySessionStore } from "../../src/core/session/store.js";
import type { AuthStrategy, LoginInfo } from "../../src/core/auth/strategy.js";
import type { PersistedSession } from "../../src/core/session/store.js";
import { fakeSession, serializeFake, type FakeSession } from "../helpers/fakes.js";

class FakeStrategy implements AuthStrategy<FakeSession> {
  readonly id = "fake";
  loginCalls = 0;
  restoreCalls = 0;
  restoreShouldFail = false;
  loginShouldFailAfterTokens = false;

  async login(_session: FakeSession): Promise<LoginInfo> {
    this.loginCalls++;
    if (this.loginShouldFailAfterTokens) throw new Error("exchange exploded");
    return { name: "Test Testsson", schoolName: "Testskolan", userType: "2" };
  }

  async restore(_session: FakeSession, _saved: PersistedSession): Promise<void> {
    this.restoreCalls++;
    if (this.restoreShouldFail) throw new Error("boom");
  }

  async focusChild(): Promise<void> {}
}

function makeManager(
  opts: {
    store?: MemorySessionStore;
    strategy?: FakeStrategy;
    client?: FakeSession;
  } = {},
) {
  const store = opts.store ?? new MemorySessionStore();
  const strategy = opts.strategy ?? new FakeStrategy();
  const manager = new SessionManager<FakeSession>({
    school: "testskola",
    store,
    strategies: [strategy],
    createSession: () => opts.client ?? fakeSession(),
    serialize: serializeFake,
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
    data: { accessToken: "tok" },
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
    data: { accessToken: "tok" },
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
    data: { accessToken: "tok" },
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
    data: { accessToken: "tok" },
    savedAt: Date.now(),
    authMethod: "fake",
  });
  const client = fakeSession({ verify: async () => false });
  const { manager } = makeManager({ store, client });
  await assert.rejects(() => manager.ensureSession(), NotAuthenticatedError);
  assert.equal(store.load(), null);
});

test("login failure after tokens were obtained still persists the tokens", async () => {
  // Scenario: BankID + code exchange succeeded (tokens on the client), but
  // the later cookie exchange threw. The expensive part (BankID) must not
  // be repeated: tokens are saved so restore() can retry the exchange.
  const store = new MemorySessionStore();
  const strategy = new FakeStrategy();
  strategy.loginShouldFailAfterTokens = true;
  const { manager } = makeManager({ store, strategy });
  await assert.rejects(() => manager.login(), /exchange exploded/);
  const saved = store.load();
  assert.ok(saved, "tokens persisted despite login failure");
  assert.equal(saved.data.accessToken, "tok");
  assert.equal(saved.authMethod, "fake");
});

test("login failure before any token leaves the store empty", async () => {
  const store = new MemorySessionStore();
  const strategy = new FakeStrategy();
  strategy.loginShouldFailAfterTokens = true;
  const { manager } = makeManager({
    store,
    strategy,
    client: fakeSession({ accessToken: null, refreshToken: null }),
  });
  await assert.rejects(() => manager.login(), /exchange exploded/);
  assert.equal(store.load(), null);
});

test("login persists whatever the provider serializes, verbatim", async () => {
  const store = new MemorySessionStore();
  const { manager } = makeManager({
    store,
    client: fakeSession({ accessToken: "A", refreshToken: "R" }),
  });
  await manager.login();
  assert.deepEqual(store.load()?.data, { accessToken: "A", refreshToken: "R" });
});

test("a session saved by another provider is refused and cleared", async () => {
  const store = new MemorySessionStore();
  store.save({
    provider: "othervendor",
    school: "testskola",
    data: {},
    savedAt: 1,
    authMethod: "fake",
  });
  const { manager } = makeManager({ store });
  await assert.rejects(manager.ensureSession(), /provider "othervendor", not "schoolsoft"/);
  assert.equal(store.load(), null);
});

test("guards: no strategies, unknown strategy id, explicit strategy id, unknown saved authMethod falls back", async () => {
  assert.throws(
    () =>
      new SessionManager<FakeSession>({
        school: "s",
        store: new MemorySessionStore(),
        strategies: [],
        createSession: () => fakeSession(),
        serialize: serializeFake,
      }),
    /at least one AuthStrategy/,
  );
  const { manager, store, strategy } = makeManager();
  await assert.rejects(manager.login("nope"), /unknown auth strategy "nope"; available: fake/);
  await manager.login("fake");
  assert.equal(strategy.loginCalls, 1);
  store.save({ ...store.load()!, authMethod: "vanished" });
  const fresh = makeManager({ store, strategy });
  await fresh.manager.ensureSession();
  assert.equal(strategy.restoreCalls, 1, "default strategy restored the session");
});

test("persist copes with a client without tokens; a non-Error restore failure is stringified", async () => {
  const { manager, store } = makeManager({
    client: fakeSession({ accessToken: null, refreshToken: null }),
  });
  await manager.login();
  const saved = store.load()!;
  assert.deepEqual(saved.data, {}, "nothing to persist from a session without tokens");
  assert.equal(saved.provider, "schoolsoft", "default provider id recorded");

  class Weird extends FakeStrategy {
    override async restore(): Promise<void> {
      throw "plain string";
    }
  }
  const weird = makeManager({ store, strategy: new Weird() });
  await assert.rejects(weird.manager.ensureSession(), /restore failed: plain string/);
});
