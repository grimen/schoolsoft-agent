/**
 * What the session manager does between logins: reports lifecycle events,
 * persists a rotated credential at once, keeps the saved session through
 * transient failures, serialises restores and renewals, and renews without
 * ever logging in.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MemorySessionHistoryStore,
  MemorySessionStore,
  NetworkError,
  NotAuthenticatedError,
  SessionHistoryRecorder,
  SessionManager,
  UpstreamError,
  isTransient,
  type PersistedSession,
  type SessionEvent,
} from "../../src/core/index.js";
import {
  CONTEXT,
  FakeAuth,
  fakeSession,
  serializeFake,
  type FakeSession,
} from "../helpers/fakes.js";

class ScriptedAuth extends FakeAuth {
  restoreCalls = 0;
  restoreError: unknown = null;
  /** When set, restore waits for it (to overlap two callers). */
  gate: Promise<void> | null = null;
  /** Called inside restore/renew, the way a provider reports a rotated token. */
  onRotate: (() => void) | null = null;

  override async restore(s: FakeSession, saved: PersistedSession): Promise<void> {
    this.restoreCalls++;
    await this.gate;
    if (this.onRotate) {
      s.refreshToken = "rotated";
      this.onRotate();
    }
    if (this.restoreError) throw this.restoreError;
    await super.restore(s, saved);
  }
  override async renew(): Promise<{ expiresAt: number | null }> {
    if (this.onRotate && !this.renewError) {
      this.session!.refreshToken = "rotated";
      this.onRotate();
    }
    return super.renew();
  }
  session: FakeSession | null = null;
}

const SAVED: PersistedSession = {
  school: "testskola",
  data: { accessToken: "tok", refreshToken: "ref" },
  guardian: { ...CONTEXT },
  savedAt: 1,
  authMethod: "fake",
};

function setup(o: { saved?: PersistedSession | null; history?: boolean } = {}) {
  let t = 1_000_000;
  const store = new MemorySessionStore();
  if (o.saved !== null) store.save(o.saved ?? SAVED);
  const auth = new ScriptedAuth();
  const session = fakeSession();
  auth.session = session;
  const events: SessionEvent[] = [];
  const historyStore = new MemorySessionHistoryStore();
  const manager = new SessionManager<FakeSession>({
    school: "testskola",
    provider: "schoolsoft",
    store,
    strategies: [auth],
    createSession: () => session,
    serialize: serializeFake,
    now: () => t,
    history: o.history === false ? undefined : new SessionHistoryRecorder(historyStore, () => t),
    onEvent: (e) => events.push(e),
    webLogin: async () => ({ savedAt: t, landedOn: "https://portal.example/start", cookies: [] }),
  });
  return {
    manager,
    store,
    auth,
    session,
    events,
    historyStore,
    advance: (ms: number) => (t += ms),
    types: () => events.map((e) => e.type),
  };
}

test("events: login, child switch (only a real one), web login, web use, logout", async () => {
  const s = setup({ saved: null });
  await s.manager.login();
  await s.manager.focusChild(100); // already in focus: not a switch
  await s.manager.focusChild(101);
  s.manager.noteWebUse("read"); // no web session yet: nothing to report
  await s.manager.webLogin();
  s.manager.noteWebUse("keepalive");
  s.manager.logout();
  assert.deepEqual(s.events, [
    { type: "login" },
    { type: "child_switch" },
    { type: "web_login", since: 1_000_000 },
    { type: "web_use", since: 1_000_000, via: "keepalive" },
    { type: "logout" },
  ]);
  assert.deepEqual(
    s.historyStore.read()!.events.map((e) => e.type),
    ["login", "web_login", "web_use", "logout"],
    "the history gets the same events, minus anything about children",
  );
});

test("subscribe adds a listener and its return value removes it (twice is harmless)", async () => {
  const s = setup({ saved: null });
  const seen: string[] = [];
  const off = s.manager.subscribe((e) => seen.push(e.type));
  await s.manager.login();
  off();
  off();
  s.manager.logout();
  assert.deepEqual(seen, ["login"]);
  assert.deepEqual(s.types(), ["login", "logout"]);
});

test("a rotated credential is persisted the moment it is reported, before the rest of restore can fail", async () => {
  const s = setup();
  s.auth.onRotate = () => s.manager.noteRefresh();
  s.auth.restoreError = new NetworkError("ECONNRESET"); // the profile lookup after the refresh fails
  await assert.rejects(s.manager.ensureSession(), NetworkError);
  const saved = s.store.load()!;
  assert.equal(
    saved.data.refreshToken,
    "rotated",
    "the old refresh token is spent; the new one must survive",
  );
  assert.deepEqual(saved.guardian, CONTEXT, "guardian and the rest of the saved session are kept");
  assert.equal(saved.savedAt, 1_000_000, "stamped with the injected clock");
  assert.deepEqual(s.types(), ["refresh"]);
  // Next attempt (network back): restores with the rotated token, no login needed.
  s.auth.restoreError = null;
  s.auth.onRotate = null;
  await s.manager.ensureSession();
  assert.equal(s.auth.loginCalls, 0);
  // With nothing saved there is nothing to merge into; the event is still reported.
  const empty = setup({ saved: null });
  empty.manager.noteRefresh();
  assert.equal(empty.store.load(), null);
  assert.deepEqual(empty.types(), ["refresh"]);
});

test("transient failures keep the saved session and record no loss; a rejection clears it and records one", async () => {
  assert.equal(isTransient(new NetworkError("x")), true);
  assert.equal(isTransient(new UpstreamError(503, "token")), true);
  assert.equal(isTransient(new UpstreamError(404, "token")), false);
  assert.equal(isTransient(new UpstreamError(401, "token")), false);
  assert.equal(isTransient(new NotAuthenticatedError("x")), false);
  assert.equal(isTransient(new Error("x")), false);

  for (const blip of [new NetworkError("ENOTFOUND"), new UpstreamError(502, "profile")]) {
    const s = setup();
    s.auth.restoreError = blip;
    await assert.rejects(s.manager.ensureSession(), (e) => e === blip);
    assert.notEqual(s.store.load(), null, "a wifi blip must not cost a BankID login");
    assert.deepEqual(s.types(), []);
    s.auth.restoreError = null;
    await s.manager.ensureSession();
  }

  const s = setup();
  await s.manager.ensureSession();
  s.manager.noteRefresh();
  s.advance(90 * 60_000);
  s.auth.restoreError = new UpstreamError(401, "profile");
  await assert.rejects(s.manager.reauthenticate(), NotAuthenticatedError);
  assert.equal(s.store.load(), null);
  assert.deepEqual(s.types(), ["refresh", "session_lost"]);
  assert.deepEqual(
    s.manager.sessionHistory()?.losses.map((l) => [l.session, l.idleMinutes]),
    [["app", 90]],
  );
});

test("a session that fails verification is a recorded loss too", async () => {
  const s = setup();
  s.session.verify = async () => false;
  await assert.rejects(s.manager.ensureSession(), /session expired/);
  assert.deepEqual(s.events, [{ type: "session_lost", session: "app" }]);
});

test("restores are serialised: two callers at once restore once, and never spend the refresh token twice", async () => {
  const s = setup();
  let open!: () => void;
  s.auth.gate = new Promise<void>((r) => (open = r));
  const a = s.manager.ensureSession();
  const b = s.manager.ensureSession();
  open();
  assert.equal(await a, await b);
  assert.equal(s.auth.restoreCalls, 1);
});

test("renew: uses the saved session, reports the expiry, never logs in, and waits for a restore in progress", async () => {
  const s = setup();
  s.auth.renewExpiresAt = 1_900_000;
  let open!: () => void;
  s.auth.gate = new Promise<void>((r) => (open = r));
  const restoring = s.manager.ensureSession();
  const renewing = s.manager.renew();
  await new Promise((r) => setImmediate(r));
  assert.equal(s.auth.renewCalls, 0, "queued behind the restore");
  open();
  await restoring;
  assert.deepEqual(await renewing, { expiresAt: 1_900_000 });
  assert.deepEqual([s.auth.renewCalls, s.auth.loginCalls], [1, 0]);
});

test("renew: nothing saved, or saved for another school or provider, is NotAuthenticated without touching anything", async () => {
  for (const saved of [null, { ...SAVED, school: "annanskola" }, { ...SAVED, provider: "other" }]) {
    const s = setup({ saved });
    await assert.rejects(s.manager.renew(), /no saved session/);
    assert.equal(s.auth.renewCalls, 0);
    assert.deepEqual(s.store.load(), saved, "renew never clears what it did not understand");
    assert.deepEqual(s.types(), []);
  }
  const sameProvider = setup({
    saved: { ...SAVED, provider: "schoolsoft", authMethod: "unknown" },
  });
  await sameProvider.manager.renew();
  assert.equal(
    sameProvider.auth.renewCalls,
    1,
    "an unknown auth method falls back to the default strategy",
  );
});

test("renew: a transient failure changes nothing; a rejection ends the session, records the loss and says why", async () => {
  const s = setup();
  await s.manager.ensureSession();
  s.auth.renewError = new NetworkError("ETIMEDOUT");
  await assert.rejects(s.manager.renew(), NetworkError);
  assert.notEqual(s.store.load(), null);
  await s.manager.ensureSession(); // still established
  assert.equal(s.auth.restoreCalls, 1);

  s.auth.renewError = new NotAuthenticatedError("refresh token rejected");
  await assert.rejects(s.manager.renew(), /renewal failed: .*refresh token rejected/);
  assert.equal(s.store.load(), null);
  assert.deepEqual(s.types(), ["session_lost"]);
  await assert.rejects(s.manager.ensureSession(), /no saved session/);

  const odd = setup();
  odd.auth.renewError = "plain string";
  await assert.rejects(odd.manager.renew(), /renewal failed: plain string/);
});

test("web session loss: reports the idle time once known; without a history there is nothing to report", async () => {
  const s = setup();
  await s.manager.webLogin();
  s.manager.noteWebUse("read");
  s.advance(42 * 60_000);
  assert.equal(s.manager.noteWebSessionLost(), 42 * 60_000);
  assert.equal(s.manager.noteWebSessionLost(), null, "already recorded");
  assert.equal(s.manager.sessionHistory()?.losses.length, 1);

  const bare = setup({ history: false });
  assert.equal(bare.manager.noteWebSessionLost(), null);
  assert.equal(bare.manager.sessionHistory(), null);
  assert.deepEqual(bare.types(), ["session_lost"]);
});

test("renew: a rejection that lost a race with another process keeps that process's tokens and records no loss", async () => {
  const s = setup();
  s.auth.renewError = new NotAuthenticatedError("refresh token already used");
  const original = s.auth.renew.bind(s.auth);
  s.auth.renew = async () => {
    // Meanwhile a CLI command refreshed and saved a newer pair.
    s.store.save({ ...SAVED, data: { accessToken: "newer", refreshToken: "newer-ref" } });
    return original();
  };
  assert.deepEqual(await s.manager.renew(), { expiresAt: null });
  assert.equal(s.store.load()!.data.refreshToken, "newer-ref");
  assert.deepEqual(s.types(), []);
});
