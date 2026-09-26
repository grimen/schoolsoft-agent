/**
 * Session history: what is recorded, what is never recorded, how it is
 * bounded and how it reads after weeks of use. Injected clock, no network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FileSessionHistoryStore,
  MAX_HISTORY_EVENTS,
  MAX_HISTORY_LOSSES,
  MemorySessionHistoryStore,
  SessionHistoryRecorder,
  emptyHistory,
  summarizeHistory,
  type SessionHistory,
  type SessionHistoryStore,
} from "../../src/core/index.js";

const MIN = 60_000;

function recorder(store: SessionHistoryStore = new MemorySessionHistoryStore()) {
  let t = 1_000_000;
  const r = new SessionHistoryRecorder(store, () => t);
  return {
    r,
    store,
    advance: (minutes: number) => {
      t += minutes * MIN;
    },
    now: () => t,
  };
}

test("app session: login, refreshes with their longest survived gap, then a loss with age and idle time", () => {
  const h = recorder();
  h.r.record({ type: "login" });
  h.advance(12);
  h.r.record({ type: "refresh" });
  h.advance(600); // overnight
  h.r.record({ type: "refresh" });
  h.advance(5);
  assert.deepEqual(summarizeHistory(h.r.read(), h.now()).app, {
    since: new Date(1_000_000).toISOString(),
    ageMinutes: 617,
    lastActivity: new Date(1_000_000 + 612 * MIN).toISOString(),
    idleMinutes: 5,
    activityCount: 2,
    longestGapSurvivedMinutes: 600,
  });
  h.advance(2875);
  h.r.record({ type: "session_lost", session: "app" });
  const summary = summarizeHistory(h.r.read(), h.now());
  assert.equal(summary.app, null);
  assert.deepEqual(summary.losses, [
    {
      session: "app",
      at: new Date(h.now()).toISOString(),
      ageMinutes: 3492,
      idleMinutes: 2880,
      activityCount: 2,
      longestGapSurvivedMinutes: 600,
    },
  ]);
  assert.equal(summary.recordedSince, new Date(1_000_000).toISOString());
});

test("web session: login time comes from the stored web session; uses, keepalive touches and the loss are timed", () => {
  const h = recorder();
  h.advance(10);
  h.r.record({ type: "web_login", since: 1_000_000 + 9 * MIN });
  h.advance(20);
  h.r.record({ type: "web_use", since: 1_000_000 + 9 * MIN, via: "read" });
  assert.equal(h.r.idleMs("web"), 0);
  h.advance(8);
  h.r.record({ type: "web_use", since: 1_000_000 + 9 * MIN, via: "keepalive" });
  h.advance(45);
  assert.equal(h.r.idleMs("web"), 45 * MIN);
  h.r.record({ type: "session_lost", session: "web" });
  const [loss] = summarizeHistory(h.r.read(), h.now()).losses;
  assert.deepEqual(
    [loss.session, loss.ageMinutes, loss.idleMinutes, loss.longestGapSurvivedMinutes],
    ["web", 74, 45, 21],
  );
  assert.equal(h.r.idleMs("web"), null, "a dead session is no longer tracked");
  // Reported once: repeated failures against the same dead session add nothing.
  h.r.record({ type: "session_lost", session: "web" });
  assert.equal(h.r.read().losses.length, 1);
});

test("sessions that predate the history: a refresh has no known start, a web use takes the stored login time", () => {
  const h = recorder();
  h.r.record({ type: "refresh" });
  h.r.record({ type: "web_use", since: 400_000, via: "read" });
  const s = summarizeHistory(h.r.read(), h.now());
  assert.deepEqual([s.app?.since, s.app?.ageMinutes, s.app?.activityCount], [null, null, 1]);
  assert.equal(s.web?.since, new Date(400_000).toISOString());
  h.r.record({ type: "session_lost", session: "app" });
  assert.equal(summarizeHistory(h.r.read(), h.now()).losses[0].ageMinutes, null);
});

test("logout ends both spans without counting as a loss; child switches are not recorded at all", () => {
  const h = recorder();
  h.r.record({ type: "login" });
  h.r.record({ type: "web_login", since: h.now() });
  h.r.record({ type: "child_switch" });
  h.r.record({ type: "logout" });
  const stored = h.r.read();
  assert.deepEqual([stored.app, stored.web, stored.losses], [null, null, []]);
  assert.deepEqual(
    stored.events.map((e) => e.type),
    ["login", "web_login", "logout"],
  );
});

test("the record is bounded, and holds timestamps and counters only", () => {
  const h = recorder();
  for (let i = 0; i < MAX_HISTORY_LOSSES + 5; i++) {
    h.r.record({ type: "login" });
    h.advance(1);
    h.r.record({ type: "session_lost", session: "app" });
  }
  for (let i = 0; i < MAX_HISTORY_EVENTS; i++) h.r.record({ type: "refresh" });
  const stored = h.r.read();
  assert.equal(stored.events.length, MAX_HISTORY_EVENTS);
  assert.equal(stored.losses.length, MAX_HISTORY_LOSSES);
  assert.equal(
    summarizeHistory(stored, h.now()).losses.length,
    10,
    "the summary shows the last ten",
  );
  // Every leaf is a number, null, or one of a fixed set of words: no room for a token, cookie or name.
  const words = new Set(["app", "web", "login", "logout", "refresh", "web_login", "web_use"]);
  words.add("app_lost").add("web_lost");
  const walk = (v: unknown): void => {
    if (v === null || typeof v === "number") return;
    if (typeof v === "string") return assert.ok(words.has(v), `unexpected text in history: ${v}`);
    for (const child of Object.values(v as object)) walk(child);
  };
  walk(stored);
  assert.ok(JSON.stringify(stored).length < 40_000);
});

test("an empty history summarises to nothing known", () => {
  assert.deepEqual(summarizeHistory(emptyHistory(), 5), {
    recordedSince: null,
    app: null,
    web: null,
    losses: [],
  });
});

test("recording is best effort: a store that cannot be written never breaks the caller", () => {
  const broken: SessionHistoryStore = {
    read: () => null,
    write: () => {
      throw new Error("read-only file system");
    },
  };
  const r = new SessionHistoryRecorder(broken, () => 1);
  r.record({ type: "login" });
  assert.deepEqual(r.read(), emptyHistory());
});

test("file store: 0600 json in the state dir; absent, corrupt or malformed-version files read as nothing", () => {
  const dir = mkdtempSync(join(tmpdir(), "ss-history-"));
  try {
    const store = new FileSessionHistoryStore(join(dir, "state"), "schoolsoft:taby");
    assert.equal(store.read(), null);
    const h = recorder(store);
    h.r.record({ type: "login" });
    const file = join(dir, "state", "session-history.json");
    assert.equal(statSync(file).mode & 0o777, 0o600);
    const stored = JSON.parse(readFileSync(file, "utf8")) as {
      accounts: Record<string, SessionHistory>;
    };
    assert.equal(stored.accounts["schoolsoft:taby"].app?.activityCount, 0);
    assert.equal(store.read()?.events.length, 1);
    writeFileSync(file, "{broken");
    assert.equal(store.read(), null);
    writeFileSync(file, JSON.stringify({ version: "2" }));
    assert.equal(store.read(), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
