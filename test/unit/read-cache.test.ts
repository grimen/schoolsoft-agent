/**
 * Read cache: the port's default implementation, the portal decorator and
 * the policy. The property that matters most: one child's data is never
 * served for another, also when reads and child switches interleave.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  CAPABILITIES,
  DEFAULT_CACHE_TTL_MS,
  MemoryReadCache,
  cacheKey,
  normalizeArgs,
  withReadCache,
  type CacheScope,
  type Capability,
} from "../../src/core/index.js";
import { WEB_SESSION_CAPABILITIES } from "../../src/providers/schoolsoft/routing.js";
import { CountingPortal, markedLesson } from "../helpers/counting-portal.js";

const lunchOf = (description: string) => [
  { date: "2026-09-07", weekday: 1, dishes: [{ kind: null, description }] },
];

const MIN = 60_000;

function clock(start = 1_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

function setup(
  o: { mode?: "read" | "refresh"; guard?: () => void; ttls?: typeof DEFAULT_CACHE_TTL_MS } = {},
) {
  const c = clock();
  const cache = new MemoryReadCache(c.now);
  let scope: CacheScope | null = {
    provider: "schoolsoft",
    school: "taby",
    userId: 21,
    childId: 100,
  };
  const upstream = new CountingPortal(() => scope?.childId ?? -1);
  const options = {
    cache,
    ttls: o.ttls ?? DEFAULT_CACHE_TTL_MS,
    never: WEB_SESSION_CAPABILITIES,
    scope: () => scope,
    guard: o.guard,
  };
  return {
    ...c,
    cache,
    upstream,
    portal: withReadCache(upstream, { ...options, mode: o.mode }),
    fresh: withReadCache(upstream, { ...options, mode: "refresh" }),
    /** A child switch as production does it: new focus, cache cleared. */
    focus: (childId: number) => {
      scope = { ...scope!, childId };
      cache.clear();
    },
    setScope: (s: CacheScope | null) => {
      scope = s;
    },
  };
}

test("MemoryReadCache: copies in and out, expiry, overwrite, clear bumps the epoch", () => {
  const c = clock();
  const cache = new MemoryReadCache(c.now, 3);
  const value = { lessons: ["Matematik"] };
  cache.set("k", value, 1000);
  value.lessons.push("mutated after set");
  const first = cache.get("k") as typeof value;
  assert.deepEqual(first, { lessons: ["Matematik"] });
  first.lessons.push("mutated by a caller");
  assert.deepEqual(cache.get("k"), { lessons: ["Matematik"] });
  c.advance(999);
  assert.notEqual(cache.get("k"), undefined);
  c.advance(1);
  assert.equal(cache.get("k"), undefined, "expired exactly at its TTL");
  assert.equal(cache.size(), 0, "an expired entry is dropped when it is met");
  cache.set("never", 1, 0);
  assert.equal(cache.size(), 0, "a TTL of zero stores nothing");
  cache.set("k", 1, 1000);
  cache.set("k", 2, 1000);
  assert.equal(cache.get("k"), 2);
  assert.equal(cache.epoch(), 0);
  cache.clear();
  assert.deepEqual([cache.size(), cache.epoch(), cache.get("k")], [0, 1, undefined]);
});

test("MemoryReadCache: bounded, least recently used goes first, expired entries are purged on write", () => {
  const c = clock();
  const cache = new MemoryReadCache(c.now, 3);
  cache.set("a", 1, 10_000);
  cache.set("b", 2, 10_000);
  cache.set("c", 3, 10_000);
  cache.get("a"); // a is now the most recently used
  cache.set("d", 4, 10_000);
  assert.deepEqual(
    ["a", "b", "c", "d"].map((k) => cache.get(k)),
    [1, undefined, 3, 4],
  );
  cache.set("short", 5, 10);
  c.advance(11);
  cache.set("e", 6, 10_000);
  assert.equal(cache.size(), 3, "the expired entry made room; nothing live was evicted");
  assert.equal(new MemoryReadCache().size(), 0, "defaults: real clock, 200 entries");
});

test("keys: provider, school, guardian, child, capability and normalised arguments all separate entries", () => {
  const scope: CacheScope = { provider: "schoolsoft", school: "taby", userId: 21, childId: 100 };
  const base = cacheKey(scope, "getScheduleWeek", [37]);
  for (const other of [
    cacheKey({ ...scope, provider: "other" }, "getScheduleWeek", [37]),
    cacheKey({ ...scope, school: "nacka" }, "getScheduleWeek", [37]),
    cacheKey({ ...scope, userId: 22 }, "getScheduleWeek", [37]),
    cacheKey({ ...scope, childId: 101 }, "getScheduleWeek", [37]),
    cacheKey(scope, "getLunchWeek", [37]),
    cacheKey(scope, "getScheduleWeek", [38]),
  ]) {
    assert.notEqual(other, base);
  }
  assert.equal(normalizeArgs([undefined]), normalizeArgs([]), "an omitted optional argument");
  assert.equal(normalizeArgs([1, undefined, undefined]), normalizeArgs([1]));
  assert.equal(normalizeArgs([" 2026-09-01 ", "2026-09-07"]), '["2026-09-01","2026-09-07"]');
  assert.notEqual(normalizeArgs([undefined, 2]), normalizeArgs([2]), "position is kept");
  assert.notEqual(normalizeArgs([1, 23]), normalizeArgs([12, 3]));
});

test("a repeated read is answered from memory until its TTL; fresh bypasses and replaces the entry", async () => {
  const s = setup();
  const first = await s.portal.getScheduleWeek(37);
  assert.deepEqual(await s.portal.getScheduleWeek(37), first);
  assert.equal(s.upstream.calls.length, 1);
  assert.notDeepEqual(await s.portal.getScheduleWeek(38), first, "other arguments, other entry");
  const fresh = await s.fresh.getScheduleWeek(37);
  assert.deepEqual(fresh, [markedLesson("child 100 getScheduleWeek #3")]);
  assert.deepEqual(await s.portal.getScheduleWeek(37), fresh, "the fresh read replaced the entry");
  s.advance(30 * MIN);
  assert.deepEqual(await s.portal.getScheduleWeek(37), [
    markedLesson("child 100 getScheduleWeek #4"),
  ]);
});

test("two children, same capability and arguments: each only ever gets its own data", async () => {
  const s = setup();
  assert.deepEqual(await s.portal.getLunchWeek(20, 37, 2026), lunchOf("child 100 getLunchWeek #1"));
  s.focus(101);
  assert.deepEqual(await s.portal.getLunchWeek(20, 37, 2026), lunchOf("child 101 getLunchWeek #2"));
  s.focus(100);
  assert.deepEqual(await s.portal.getLunchWeek(20, 37, 2026), lunchOf("child 100 getLunchWeek #3"));
  // Even a cache that was NOT cleared on the switch keeps the children apart, by key.
  s.setScope({ provider: "schoolsoft", school: "taby", userId: 21, childId: 101 });
  assert.deepEqual(await s.portal.getLunchWeek(20, 37, 2026), lunchOf("child 101 getLunchWeek #4"));
  s.setScope({ provider: "schoolsoft", school: "taby", userId: 21, childId: 100 });
  assert.deepEqual(await s.portal.getLunchWeek(20, 37, 2026), lunchOf("child 100 getLunchWeek #3"));
});

test("concurrent children: a read that overlaps a child switch is returned but never stored", async () => {
  const s = setup();
  let release!: () => void;
  s.upstream.during = () => new Promise<void>((r) => (release = r));
  const slow = s.portal.getScheduleWeek(37); // child 100, in flight
  await Promise.resolve();
  s.upstream.during = null;
  s.focus(101); // another caller switches child meanwhile
  const other = await s.portal.getScheduleWeek(37);
  assert.deepEqual(other, [markedLesson("child 101 getScheduleWeek #2")]);
  release();
  assert.deepEqual(
    await slow,
    [markedLesson("child 100 getScheduleWeek #1")],
    "the caller still gets its answer",
  );
  assert.equal(s.cache.size(), 1, "only child 101's read was stored");
  assert.deepEqual(await s.portal.getScheduleWeek(37), other);
  s.focus(100);
  assert.deepEqual(
    await s.portal.getScheduleWeek(37),
    [markedLesson("child 100 getScheduleWeek #3")],
    "child 100 is read again rather than served anything stored during the overlap",
  );
});

test("a focus change without a clear (A to B and back) still blocks the store, through the scope check", async () => {
  const s = setup();
  let release!: () => void;
  s.upstream.during = () => new Promise<void>((r) => (release = r));
  const slow = s.portal.getScheduleWeek(37);
  await Promise.resolve();
  s.upstream.during = null;
  s.setScope({ provider: "schoolsoft", school: "taby", userId: 21, childId: 101 });
  release();
  await slow;
  assert.equal(s.cache.size(), 0);
  // ... and so does a logout (no scope) while the read is in flight.
  s.setScope({ provider: "schoolsoft", school: "taby", userId: 21, childId: 100 });
  s.upstream.during = () => new Promise<void>((r) => (release = r));
  const again = s.portal.getScheduleWeek(37);
  await Promise.resolve();
  s.setScope(null);
  release();
  await again;
  assert.equal(s.cache.size(), 0);
});

test("without a session scope nothing is cached or served; failures and undefined are never stored", async () => {
  const s = setup();
  s.setScope(null);
  await s.portal.getScheduleWeek(37);
  await s.portal.getScheduleWeek(37);
  assert.equal(s.upstream.calls.length, 2);
  s.setScope({ provider: "schoolsoft", school: "taby", userId: 21, childId: 100 });
  s.upstream.failNext = new Error("HTTP 500");
  await assert.rejects(s.portal.getScheduleWeek(37), /HTTP 500/);
  assert.equal(s.cache.size(), 0);
  const empty = new CountingPortal(() => 100);
  empty.getNews = async () => undefined as unknown as unknown[];
  const portal = withReadCache(empty, {
    cache: s.cache,
    ttls: DEFAULT_CACHE_TTL_MS,
    never: [],
    scope: () => ({ provider: "p", school: "s", userId: 1, childId: 1 }),
  });
  await portal.getNews(1, 2, 3);
  assert.equal(s.cache.size(), 0);
});

test("the host guard runs before the cache is consulted, on a hit as well as a miss", async () => {
  let allowed = true;
  const s = setup({
    guard: () => {
      if (!allowed) throw new Error("revoked");
    },
  });
  await s.portal.getScheduleWeek(37);
  allowed = false;
  await assert.rejects(s.portal.getScheduleWeek(37), /revoked/);
  await assert.rejects(s.fresh.getScheduleWeek(37), /revoked/);
  assert.equal(s.upstream.calls.length, 1);
});

test("policy: gated capabilities are never cached, even if a TTL is configured for them", async () => {
  for (const capability of WEB_SESSION_CAPABILITIES) {
    assert.equal(DEFAULT_CACHE_TTL_MS[capability], undefined, capability);
  }
  const s = setup({
    ttls: { ...DEFAULT_CACHE_TTL_MS, getGrades: 60 * MIN, getGradePrognosis: MIN },
  });
  await s.portal.getGrades();
  await s.portal.getGrades();
  await s.portal.getGradePrognosis();
  await s.portal.getGradePrognosis();
  assert.equal(s.upstream.calls.length, 4);
  assert.equal(s.cache.size(), 0);
});

test("policy: session probes, inbox, messages and bookings are read every time; every TTL is between 1 minute and 6 hours", async () => {
  const uncached: Capability[] = [
    "getParent",
    "getSession",
    "getNextCalendarEvent",
    "getInbox",
    "getMessage",
    "getBookings",
  ];
  for (const capability of uncached) assert.equal(DEFAULT_CACHE_TTL_MS[capability], undefined);
  for (const [capability, ttl] of Object.entries(DEFAULT_CACHE_TTL_MS)) {
    assert.ok(CAPABILITIES.includes(capability as Capability), capability);
    assert.ok(ttl >= MIN && ttl <= 360 * MIN, capability);
  }
  const s = setup();
  await s.portal.getInbox(21, 20);
  await s.portal.getInbox(21, 20);
  await s.portal.getParent();
  await s.portal.getParent();
  assert.equal(s.upstream.calls.length, 4);
});

test("every capability passes through with its arguments and result", async () => {
  const s = setup();
  assert.deepEqual(await s.portal.getAssignmentDetail(7), {
    view: "child 100 getAssignmentDetail #1",
    sections: [],
  });
  assert.equal((await s.portal.getAssessmentCriteria("Svenska", 1)).title.includes("#2"), true);
  assert.deepEqual(s.upstream.calls, [
    "getAssignmentDetail(7)@100",
    "getAssessmentCriteria(Svenska,1)@100",
  ]);
});

test("the cache never touches the disk: no filesystem, process or network module in src/core/cache or the decorator", () => {
  const dir = join(process.cwd(), "src/core/cache");
  const files = [
    ...readdirSync(dir).map((f) => join(dir, f)),
    join(process.cwd(), "src/core/portal/cached.ts"),
  ];
  assert.ok(files.length >= 3);
  for (const file of files) {
    const imports = [...readFileSync(file, "utf8").matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    for (const spec of imports) {
      assert.ok(spec.startsWith("."), `${file} imports ${spec}; the cache is memory only`);
      assert.doesNotMatch(spec, /store|file|history/, `${file} imports ${spec}`);
    }
  }
});

test("a write is never cached: the same report reaches the portal every time, and has no TTL", async () => {
  const s = setup();
  const notice = { studentId: 100, startDate: "2026-09-21", endDate: "2026-09-21", fullDay: true };
  const first = await s.portal.reportAbsence(notice);
  const second = await s.portal.reportAbsence(notice);
  assert.notDeepEqual(first, second);
  assert.equal(s.upstream.calls.filter((c) => c.startsWith("reportAbsence(")).length, 2);
  assert.equal(DEFAULT_CACHE_TTL_MS.reportAbsence, undefined);
});
