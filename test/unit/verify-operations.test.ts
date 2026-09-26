/**
 * The doctor --verify engine (core/operations/verify.ts) against a real
 * SessionManager, the fake auth strategy and complete fake portals: which
 * operations run, with which inputs, how each outcome is classified, skips
 * for gated and browser-backed operations, --all-children and exit codes.
 * The CLI over the production wiring is test/functional/doctor-verify.test.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  MemorySessionStore,
  NetworkError,
  NotAuthenticatedError,
  UpstreamError,
  VERIFY_EXCLUSIONS,
  defineOperation,
  isVerifiable,
  operations,
  verifyExitCode,
  verifyOperations,
  READ_ONLY,
  type AbsenceNotice,
  type AbsenceReceipt,
  type GuardianContext,
  type Operation,
  type OperationContext,
  type PersistedSession,
  type VerifyReport,
  type WebSession,
} from "../../src/core/index.js";
import { ResponseDriftError } from "../../src/core/errors/index.js";
import type { LunchDay } from "../../src/core/domain/schemas.js";
import { CONTEXT, makeContext } from "../helpers/fakes.js";
import { CountingPortal } from "../helpers/counting-portal.js";

const TYPED = ["list_children", "get_schedule", "get_calendar", "get_lunch_menu", "get_messages"];

/** A complete portal that fails the test if anything tries to write. */
class ReadOnlyPortal extends CountingPortal {
  override async reportAbsence(_notice: AbsenceNotice): Promise<AbsenceReceipt> {
    throw new Error("a write was attempted during verification");
  }
}

const WEB: WebSession = { cookies: [], savedAt: 1, landedOn: "https://portal.example.test/start" };

function saved(guardian: GuardianContext = CONTEXT, web?: WebSession): PersistedSession {
  return { school: "testskola", data: {}, guardian, web, savedAt: 1, authMethod: "fake" };
}

/** A real SessionManager with a saved session, reads served by a ReadOnlyPortal. */
function setup(o: { guardian?: GuardianContext; web?: WebSession; empty?: boolean } = {}) {
  const store = new MemorySessionStore();
  if (!o.empty) store.save(saved(o.guardian, o.web));
  const h = makeContext({ store });
  const portal = new ReadOnlyPortal(() => h.manager.guardian().childInFocus);
  const ctx: OperationContext = { ...h.ctx, portal };
  return { ...h, ctx, portal };
}

test("the registry's verifiable operations are the five typed reads; nothing is excluded today", () => {
  assert.deepEqual(
    operations.filter(isVerifiable).map((op) => op.name),
    TYPED,
  );
  assert.deepEqual(VERIFY_EXCLUSIONS, {});
});

test("all ok: each typed read runs once for the child in focus, fresh where declared, exit 0", async () => {
  const { ctx, portal } = setup();
  const fresh = new ReadOnlyPortal(() => ctx.manager.guardian().childInFocus);
  const report = await verifyOperations({ ...ctx, freshPortal: fresh }, { browserReady: false });
  assert.deepEqual(report, {
    ok: true,
    session: "ok",
    children: { total: 2, verified: [1] },
    summary: { ok: 5, drift: 0, skipped: 0, error: 0 },
    results: [
      { operation: "list_children", status: "ok" },
      { operation: "get_schedule", child: 1, status: "ok" },
      { operation: "get_calendar", child: 1, status: "ok" },
      { operation: "get_lunch_menu", child: 1, status: "ok" },
      { operation: "get_messages", child: 1, status: "ok" },
    ],
  } satisfies VerifyReport);
  assert.equal(verifyExitCode(report), 0);
  // fresh: true sends the cacheable reads to the portal that bypasses the cache
  assert.deepEqual(
    fresh.calls.map((c) => c.split("(")[0]),
    ["getScheduleWeek", "getCalendar", "getLunchWeek"],
  );
  // get_messages declares no fresh (never cached); nothing else touched the cached portal
  assert.deepEqual(
    portal.calls.map((c) => c.split("(")[0]),
    ["getInbox"],
  );
  assert.ok(![...portal.calls, ...fresh.calls].some((c) => c.startsWith("reportAbsence")));
});

test("drift in one operation: path and code only, the others still run, exit 7", async () => {
  const { ctx, portal } = setup();
  portal.getScheduleWeek = async () => {
    throw new ResponseDriftError("getScheduleWeek", "0.startDate invalid_type");
  };
  // a result that fails the operation's own output schema is drift too
  portal.getLunchWeek = async () => [{ date: "not a date" } as unknown as LunchDay];
  const report = await verifyOperations(ctx, { browserReady: true });
  assert.equal(report.ok, false);
  assert.deepEqual(report.summary, { ok: 3, drift: 2, skipped: 0, error: 0 });
  assert.deepEqual(report.results[1], {
    operation: "get_schedule",
    child: 1,
    status: "drift",
    at: "getScheduleWeek",
    detail: "0.startDate invalid_type",
  });
  const lunch = report.results[3];
  assert.equal(lunch.status, "drift");
  assert.equal(lunch.status === "drift" && lunch.at, "get_lunch_menu");
  assert.match(lunch.status === "drift" ? lunch.detail : "", /^days\.0\.date /);
  assert.doesNotMatch(JSON.stringify(report), /not a date|Ett|Två|Testsson|Testskolan/);
  assert.equal(verifyExitCode(report), 7);
});

test("errors are not drift: kind, message key, retryable and HTTP status, never the message", async () => {
  const { ctx, portal } = setup();
  portal.getScheduleWeek = async () => {
    throw new NetworkError("ECONNRESET");
  };
  portal.getCalendar = async () => {
    throw new UpstreamError(503, "calendar for Ett");
  };
  portal.getInbox = async () => {
    throw new Error("Ett's inbox exploded");
  };
  const report = await verifyOperations(ctx, { browserReady: true });
  assert.deepEqual(report.results.slice(1), [
    {
      operation: "get_schedule",
      child: 1,
      status: "error",
      kind: "network",
      code: "network",
      retryable: true,
    },
    {
      operation: "get_calendar",
      child: 1,
      status: "error",
      kind: "upstream",
      code: "upstream",
      retryable: true,
      httpStatus: 503,
    },
    { operation: "get_lunch_menu", child: 1, status: "ok" },
    {
      operation: "get_messages",
      child: 1,
      status: "error",
      kind: "internal",
      code: "internal",
      retryable: false,
    },
  ]);
  assert.doesNotMatch(JSON.stringify(report), /Ett|ECONNRESET|exploded/);
  // no drift: the first error's kind decides
  assert.equal(verifyExitCode(report), 4);
  assert.equal(
    verifyExitCode({ ...report, results: report.results.slice(4) }),
    1,
    "only a bug left: exit 1",
  );
});

/** A typed read operation over one capability, for the skip rules. */
function typedRead<const C extends "getGrades" | "getContacts">(name: string, capability: C) {
  return defineOperation({
    name,
    title: name,
    description: `${name}\n\nUse when: testing.`,
    input: {},
    output: z.object({ read: z.boolean() }),
    portal: [capability],
    annotations: READ_ONLY,
    async run(ctx) {
      await ctx.portal[capability]();
      return { read: true };
    },
  }) as unknown as Operation;
}

test("gated operations need a saved web session, browser-backed ones the browser; excluded ones say why", async () => {
  const gated = typedRead("gated_read", "getGrades");
  const browser = typedRead("browser_read", "getContacts");
  const excluded = typedRead("needs_an_id", "getContacts");
  const untyped = { ...gated, name: "untyped", output: undefined };
  const writing = { ...gated, name: "writing", annotations: { ...READ_ONLY, readOnly: false } };
  const destructive = {
    ...gated,
    name: "destroy",
    annotations: { ...READ_ONLY, destructive: true },
  };
  const anonymous = { ...gated, name: "anon", annotations: { ...READ_ONLY, requiresAuth: false } };
  const ops = [gated, browser, excluded, untyped, writing, destructive, anonymous];
  const exclusions = { needs_an_id: "needs a message id" };

  const none = setup();
  const noWeb = await verifyOperations(none.ctx, {
    operations: ops,
    exclusions,
    browserReady: false,
  });
  assert.deepEqual(noWeb.results, [
    { operation: "gated_read", status: "skipped", reason: "web_session_required" },
    { operation: "browser_read", status: "skipped", reason: "browser_not_installed" },
    { operation: "needs_an_id", status: "skipped", reason: "excluded", note: "needs a message id" },
  ]);
  assert.deepEqual(none.portal.calls, [], "a skip makes no request");
  assert.equal(noWeb.ok, true);
  assert.equal(verifyExitCode(noWeb), 0, "skips are not failures");

  const web = setup({ web: WEB });
  const noBrowser = await verifyOperations(web.ctx, {
    operations: ops,
    exclusions,
    browserReady: false,
  });
  assert.deepEqual(
    noBrowser.results.map((r) => r.status === "skipped" && r.reason),
    ["browser_not_installed", "browser_not_installed", "excluded"],
  );

  const ready = await verifyOperations(web.ctx, {
    operations: ops,
    exclusions,
    browserReady: true,
  });
  assert.deepEqual(
    ready.results.map((r) => r.status),
    ["ok", "ok", "skipped"],
  );
  assert.deepEqual(
    web.portal.calls.map((c) => c.split("(")[0]),
    ["getGrades", "getContacts"],
  );
});

test("drift of the guardian profile: session drift, every operation skipped, exit 7", async () => {
  const { ctx, strategy, store, portal } = setup();
  strategy.restore = async () => {
    throw new ResponseDriftError("getParent", "children.0.studentId invalid_type");
  };
  const report = await verifyOperations(ctx, { browserReady: true });
  assert.deepEqual(report.session, {
    status: "drift",
    at: "getParent",
    detail: "children.0.studentId invalid_type",
  });
  assert.equal(report.children, null);
  assert.deepEqual(report.summary, { ok: 0, drift: 0, skipped: 5, error: 0 });
  assert.ok(report.results.every((r) => r.status === "skipped" && r.reason === "session_drift"));
  assert.equal(report.ok, false);
  assert.equal(verifyExitCode(report), 7);
  assert.deepEqual(portal.calls, []);
  assert.notEqual(store.load(), null, "drift keeps the saved session");
});

test("no saved session: the not-authenticated error before any request", async () => {
  const { ctx, portal } = setup({ empty: true });
  await assert.rejects(
    verifyOperations(ctx, { browserReady: true }),
    (e: unknown) => e instanceof NotAuthenticatedError,
  );
  assert.deepEqual(portal.calls, []);
});

test("--all-children: child-scoped reads per child by position, the child in focus restored", async () => {
  const { ctx, portal, manager, store } = setup({ guardian: { ...CONTEXT, childInFocus: 101 } });
  const single = await verifyOperations(ctx, { browserReady: true });
  assert.deepEqual(single.children, { total: 2, verified: [2] }, "default: the child in focus");
  assert.ok(single.results.slice(1).every((r) => r.child === 2));
  portal.calls.length = 0;

  const all = await verifyOperations(ctx, { browserReady: true, allChildren: true });
  assert.deepEqual(all.children, { total: 2, verified: [1, 2] });
  assert.deepEqual(
    all.results.map((r) => `${r.operation}${r.child === undefined ? "" : "@" + r.child}`),
    [
      "list_children",
      "get_schedule@1",
      "get_calendar@1",
      "get_lunch_menu@1",
      "get_messages@1",
      "get_schedule@2",
      "get_calendar@2",
      "get_lunch_menu@2",
      "get_messages@2",
    ],
  );
  assert.equal(all.summary.ok, 9);
  // each child's reads were made with that child in focus
  assert.deepEqual(
    portal.calls.map((c) => c.split("@")[1]),
    ["100", "100", "100", "100", "101", "101", "101", "101"],
  );
  assert.equal(manager.guardian().childInFocus, 101);
  assert.equal(store.load()?.guardian?.childInFocus, 101, "the persisted focus is unchanged");
});
