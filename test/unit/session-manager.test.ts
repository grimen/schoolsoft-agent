/**
 * Unit tests for SessionManager using injected fakes — no disk, no
 * network, no real SchoolsoftClient. Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SchoolsoftClient } from "@elias4044/ssp-node";
import { SessionManager, NotAuthenticatedError } from "../../src/core/session/session-manager.js";
import { MemorySessionStore } from "../../src/core/session/store.js";
import type { AuthStrategy, LoginInfo } from "../../src/core/auth/strategy.js";
import type { PersistedSession } from "../../src/core/session/store.js";

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
  loginShouldFailAfterTokens = false;

  async login(_client: SchoolsoftClient): Promise<LoginInfo> {
    this.loginCalls++;
    if (this.loginShouldFailAfterTokens) throw new Error("exchange exploded");
    return { name: "Test Testsson", schoolName: "Testskolan", userType: "2" };
  }

  async restore(_client: SchoolsoftClient, _saved: PersistedSession): Promise<void> {
    this.restoreCalls++;
    if (this.restoreShouldFail) throw new Error("boom");
  }
}

function makeManager(
  opts: {
    store?: MemorySessionStore;
    strategy?: FakeStrategy;
    client?: SchoolsoftClient;
  } = {},
) {
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
  assert.equal(saved.accessToken, "tok");
  assert.equal(saved.authMethod, "fake");
});

test("login failure before any token leaves the store empty", async () => {
  const store = new MemorySessionStore();
  const strategy = new FakeStrategy();
  strategy.loginShouldFailAfterTokens = true;
  const { manager } = makeManager({
    store,
    strategy,
    client: fakeClient({ accessToken: null } as Partial<SchoolsoftClient>),
  });
  await assert.rejects(() => manager.login(), /exchange exploded/);
  assert.equal(store.load(), null);
});

test("login persists the access token expiry (JWT exp, unix seconds)", async () => {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const jwt = `${b64({ alg: "RS256" })}.${b64({ exp: 1_800_000_000 })}.sig`;
  const store = new MemorySessionStore();
  const { manager } = makeManager({
    store,
    client: fakeClient({ accessToken: jwt } as Partial<SchoolsoftClient>),
  });
  await manager.login();
  assert.equal(store.load()?.accessTokenExpiresAt, 1_800_000_000);
});

test("guards: no strategies, unknown strategy id, explicit strategy id, unknown saved authMethod falls back", async () => {
  assert.throws(
    () => new SessionManager({ school: "s", store: new MemorySessionStore(), strategies: [] }),
    /at least one AuthStrategy/,
  );
  const { manager, store, strategy } = makeManager();
  await assert.rejects(manager.login("nope"), /Unknown auth strategy "nope"\. Available: fake/);
  await manager.login("fake");
  assert.equal(strategy.loginCalls, 1);
  store.save({ ...store.load()!, authMethod: "vanished" });
  const fresh = makeManager({ store, strategy });
  await fresh.manager.ensureSession();
  assert.equal(strategy.restoreCalls, 1, "default strategy restored the session");
});

test("persist copes with a client without tokens; a non-Error restore failure is stringified; focusChild needs a capable strategy", async () => {
  const { manager, store } = makeManager({
    client: fakeClient({ accessToken: null as never, refreshToken: null as never }),
  });
  await manager.login();
  const saved = store.load()!;
  assert.equal(saved.accessToken, undefined);
  assert.equal(saved.refreshToken, undefined);
  assert.equal(saved.accessTokenExpiresAt, undefined);
  await assert.rejects(manager.focusChild(1), /cannot switch child/);

  class Weird extends FakeStrategy {
    override async restore(): Promise<void> {
      throw "plain string";
    }
  }
  const weird = makeManager({ store, strategy: new Weird() });
  await assert.rejects(weird.manager.ensureSession(), /restore failed: plain string/);
});
