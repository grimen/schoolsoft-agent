/**
 * `doctor --verify` end to end in-process: the CLI over the production wiring
 * (session manager, API portal, read cache, session recovery) and the offline
 * SchoolSoft stand-in answering live-shaped synthetic JSON. Covers all ok,
 * drift with no data in the output, an upstream error told apart from drift,
 * no session (exit 2, zero requests), the cache bypass, --all-children and
 * that no write is ever sent. Nothing touches the network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SchoolsoftClient } from "@elias4044/ssp-node";
import {
  MemorySessionHistoryStore,
  MemorySessionStore,
  createPortals,
  createSessionManager,
  getOperation,
  resolveConfig,
  runOperation,
  type OperationContext,
  type VerifyReport,
} from "../../src/core/index.js";
import { schoolsoftProvider } from "../../src/providers/schoolsoft/index.js";
import { runCli, type CliDeps } from "../../src/cli/program.js";
import { EXIT } from "../../src/cli/exit-codes.js";
import { SchoolsoftSim, savedSession, type SimResponse } from "../helpers/schoolsoft-sim.js";
import {
  DRIFT_FIELDS,
  driftedList,
  rawAgendaEvents,
  rawAgendaLessons,
  rawInbox,
  rawLessonsWeek,
  rawLunch,
  rawParent,
} from "../helpers/portal-json.js";

type Fetch = SimResponse | Promise<SimResponse>;

/** Production wiring over the stand-in, a saved session (unless `empty`) and fixture answers. */
function wired(
  t: { mock: { method: typeof import("node:test").mock.method } },
  o: { empty?: boolean; intercept?: (pathname: string) => Fetch | undefined } = {},
) {
  t.mock.method(SchoolsoftClient.prototype, "verifySession", async () => true);
  const now = 1_900_000_000_000;
  const sim = new SchoolsoftSim(() => now);
  const store = new MemorySessionStore();
  if (!o.empty) store.save(savedSession(now));
  const fetchImpl: typeof sim.fetch = async (url, school, request) =>
    (await o.intercept?.(new URL(url).pathname)) ?? sim.fetch(url, school, request);
  const config = resolveConfig([{ school: "taby", configDir: "/nowhere" }], {
    home: "/unused",
    platform: "linux",
  });
  const manager = createSessionManager(config, {
    store,
    history: new MemorySessionHistoryStore(),
    now: () => now,
    fetchImpl,
  });
  const portals = createPortals(manager, { fetchImpl, browser: null });
  const ctx: OperationContext = {
    manager,
    config,
    provider: schoolsoftProvider,
    log: () => {},
    ...portals,
  };
  const answers = new Map<RegExp, () => unknown>([
    [/\/eva\/api\/v1\/parent$/, rawParent],
    [/\/calendar\/lessons\/week\/\d+$/, rawLessonsWeek],
    [/\/calendar\/lessons\/agenda$/, rawAgendaLessons],
    [/\/calendar\/event\/agenda$/, rawAgendaEvents],
    [/\/lunchmenu\/\d+$/, rawLunch],
    [/\/messages\/inbox$/, rawInbox],
  ]);
  sim.override = (pathname) => {
    for (const [pattern, fn] of answers) if (pattern.test(pathname)) return fn();
    return undefined;
  };
  /** Answer a path pattern with other JSON (a drifted shape). */
  const answer = (pattern: RegExp, fn: () => unknown) => {
    const key = [...answers.keys()].find((k) => String(k) === String(pattern))!;
    answers.set(key, fn);
  };
  return { sim, store, ctx, answer };
}

async function cli(ctx: OperationContext, ...argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const deps: CliDeps = {
    getContext: () => ctx,
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    env: {},
    home: mkdtempSync(join(tmpdir(), "home-")),
    platform: "linux",
    version: "test",
    browserProbes: {
      resolvePlaywright: () => {
        throw new Error("not installed");
      },
    },
  };
  const code = await runCli(argv, deps);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

const report = (out: string) => JSON.parse(out) as VerifyReport;

/** Every name, id and free text in the fixtures that a report could leak. */
const FIXTURE_VALUES = [
  "Synthetic",
  "Guardian",
  "Ett",
  "Två",
  "Testskolan",
  "4B",
  "1A",
  "Matematik",
  "Svenska",
  "Kapitel 3",
  "Lärare Test",
  "Rektor Test",
  "A12",
  "Köttbullar",
  "Falafel",
  "Spagetti",
  "Utflykt fredag",
  "Ta med matsäck",
  "Veckobrev",
  "Veckans händelser",
  "100",
  "101",
  "5001",
  "5002",
  "7001",
  "9001",
  "2026-",
];

test("doctor --verify: all five typed reads parse, exit 0, JSON report", async (t) => {
  const { ctx } = wired(t);
  const r = await cli(ctx, "doctor", "--verify");
  assert.equal(r.code, EXIT.OK, r.err);
  assert.equal(r.err, "");
  const data = report(r.out);
  assert.equal(data.ok, true);
  assert.equal(data.session, "ok");
  assert.deepEqual(data.children, { total: 2, verified: [1] });
  assert.deepEqual(data.summary, { ok: 5, drift: 0, skipped: 0, error: 0 });
  assert.deepEqual(
    data.results.map((x) => x.operation),
    ["list_children", "get_schedule", "get_calendar", "get_lunch_menu", "get_messages"],
  );
  for (const value of FIXTURE_VALUES) assert.ok(!r.out.includes(value), value);
});

test("doctor --verify: a renamed field is drift with path and code, no value in the output, exit 7", async (t) => {
  const { ctx, answer } = wired(t);
  answer(/\/calendar\/lessons\/week\/\d+$/, () =>
    driftedList(rawLessonsWeek(), DRIFT_FIELDS.lessons, "renamed"),
  );
  const r = await cli(ctx, "--pretty", "doctor", "--verify");
  assert.equal(r.code, EXIT.UPSTREAM);
  assert.equal(r.err, "");
  const data = report(r.out);
  assert.equal(data.ok, false);
  assert.deepEqual(data.summary, { ok: 4, drift: 1, skipped: 0, error: 0 });
  const drift = data.results.find((x) => x.status === "drift")!;
  assert.equal(drift.operation, "get_schedule");
  assert.equal(drift.child, 1);
  assert.equal(drift.status === "drift" && drift.at, "getScheduleWeek");
  assert.match(drift.status === "drift" ? drift.detail : "", /^0\.startDate invalid_type/);
  for (const value of FIXTURE_VALUES) assert.ok(!r.out.includes(value), `leaked ${value}`);
});

test("doctor --verify: an upstream 5xx is an error, not drift", async (t) => {
  const { ctx } = wired(t, {
    intercept: (pathname) =>
      pathname.endsWith("/messages/inbox")
        ? { status: 503, data: "Ett's inbox is down", headers: {}, setCookies: [] }
        : undefined,
  });
  const r = await cli(ctx, "doctor", "--verify");
  assert.equal(r.code, EXIT.UPSTREAM);
  const data = report(r.out);
  assert.deepEqual(data.results.at(-1), {
    operation: "get_messages",
    child: 1,
    status: "error",
    kind: "upstream",
    code: "upstream",
    retryable: true,
    httpStatus: 503,
  });
  assert.equal(data.summary.drift, 0);
  assert.doesNotMatch(r.out, /Ett|inbox is down|messages\/inbox/);
});

test("doctor --verify without a saved session: not logged in, exit 2, zero requests", async (t) => {
  const { ctx, sim } = wired(t, { empty: true });
  const r = await cli(ctx, "doctor", "--verify");
  assert.equal(r.code, EXIT.NOT_AUTHENTICATED);
  assert.equal(r.out, "");
  assert.match(r.err, /^Not logged in/);
  assert.match(r.err, /Next: .*login/);
  assert.deepEqual(sim.requests, []);
});

test("doctor --verify reads anew: a cached answer cannot hide drift", async (t) => {
  const { ctx, sim, answer } = wired(t);
  await runOperation(getOperation("get_schedule")!, ctx, {});
  const lessonReads = () => sim.requests.filter((r) => /lessons\/week/.test(r)).length;
  assert.equal(lessonReads(), 1);
  answer(/\/calendar\/lessons\/week\/\d+$/, () =>
    driftedList(rawLessonsWeek(), DRIFT_FIELDS.lessons, "missing"),
  );
  const r = await cli(ctx, "doctor", "--verify");
  assert.equal(r.code, EXIT.UPSTREAM);
  assert.equal(lessonReads(), 2, "the cached week was bypassed");
});

test("doctor --verify --all-children: every child by position, focus restored, no write sent", async (t) => {
  const { ctx, sim, store } = wired(t);
  const r = await cli(ctx, "doctor", "--verify", "--all-children");
  assert.equal(r.code, EXIT.OK, r.err);
  const data = report(r.out);
  assert.deepEqual(data.children, { total: 2, verified: [1, 2] });
  assert.equal(data.summary.ok, 9);
  assert.deepEqual(
    data.results.filter((x) => x.child === 2).map((x) => x.operation),
    ["get_schedule", "get_calendar", "get_lunch_menu", "get_messages"],
  );
  // one lessons read per child; the first child is back in focus afterwards
  assert.equal(sim.requests.filter((x) => /lessons\/week/.test(x)).length, 2);
  assert.equal(store.load()?.guardian?.childInFocus, 100);
  assert.equal(ctx.manager.guardian().childInFocus, 100);
  assert.ok(!sim.requests.some((x) => /absence|^(POST|PUT|DELETE) /.test(x)), "no write");
  for (const value of FIXTURE_VALUES) assert.ok(!r.out.includes(value), value);
});

test("--all-children without --verify is an input error", async (t) => {
  const { ctx, sim } = wired(t);
  const r = await cli(ctx, "doctor", "--all-children");
  assert.equal(r.code, EXIT.INPUT);
  assert.match(r.err, /--all-children needs --verify/);
  assert.deepEqual(sim.requests, []);
});
