/**
 * report_absence, offline: the write switch, preview-by-default, validation
 * in Europe/Stockholm, the (unverified) request mapping, and the guarantee
 * that a write reaches the network at most once. All data is synthetic.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AgentError,
  UpstreamError,
  describeError,
  createCompositePortal,
  envSource,
  resolveConfig,
  operations,
  WRITE_CAPABILITIES,
  type AbsenceNotice,
  type OperationContext,
  type Portal,
} from "../../src/core/index.js";
import { withSessionRecovery } from "../../src/core/portal/recovering.js";
import { absenceWindow } from "../../src/core/operations/_absence-window.js";
import { stockholmToday } from "../../src/core/operations/_calendar-range.js";
import { reportAbsence } from "../../src/core/operations/report-absence.js";
import { ApiPortal, type ApiFetch } from "../../src/providers/schoolsoft/portal/api-portal.js";
import { toAbsenceNoticeBody } from "../../src/providers/schoolsoft/portal/api/absence-notice-body.js";
import { ROUTING } from "../../src/providers/schoolsoft/routing.js";
import { CONNECTOR_OPERATIONS } from "../../src/http/runtime.js";
import { CONTEXT, makeContext } from "../helpers/fakes.js";

const hasKey = (key: string) => (e: unknown) => {
  assert.ok(e instanceof AgentError, String(e));
  assert.equal(e.key, key);
  return true;
};

/** A fake written to the port the operation declares: records, never sends. */
function recordingPortal(response: unknown = { synthetic: true }) {
  const notices: AbsenceNotice[] = [];
  const portal: Pick<Portal, "reportAbsence"> = {
    reportAbsence: async (notice) => {
      notices.push(notice);
      return { status: 200, response };
    },
  };
  return { portal, notices };
}

async function writableContext(allowWrites = true) {
  const base = makeContext({ config: { allowWrites } });
  const recorder = recordingPortal();
  const ctx: OperationContext<"reportAbsence"> = { ...base.ctx, portal: recorder.portal };
  return { ...base, ctx, notices: recorder.notices };
}

// ----- the window: dates and times in Europe/Stockholm -----

test("absence window defaults to today in Stockholm across midnight and both DST changes", () => {
  for (const [now, today] of [
    ["2026-10-24T21:30:00Z", "2026-10-24"], // 23:30 CEST
    ["2026-10-24T22:30:00Z", "2026-10-25"], // 00:30 CEST, the day the clocks go back
    ["2026-10-25T22:30:00Z", "2026-10-25"], // 23:30 CET
    ["2026-10-25T23:30:00Z", "2026-10-26"],
    ["2026-03-28T22:30:00Z", "2026-03-28"], // 23:30 CET
    ["2026-03-28T23:30:00Z", "2026-03-29"], // 00:30 CET, the day the clocks go forward
    ["2026-03-29T21:30:00Z", "2026-03-29"], // 23:30 CEST
    ["2026-03-29T22:30:00Z", "2026-03-30"],
  ]) {
    assert.deepEqual(absenceWindow({}, new Date(now)), {
      start_date: today,
      end_date: today,
      days: 1,
      full_day: true,
    });
  }
});

test("yesterday in Stockholm is refused even while it is still that date in UTC", () => {
  const justAfterMidnight = new Date("2026-10-24T22:30:00Z");
  assert.throws(
    () => absenceWindow({ start_date: "2026-10-24" }, justAfterMidnight),
    hasKey("absence_window"),
  );
  assert.equal(absenceWindow({ start_date: "2026-10-25" }, justAfterMidnight).days, 1);
});

test("ranges count calendar days, so a 23- or 25-hour day is still one day", () => {
  const now = new Date("2026-03-01T12:00:00Z");
  assert.equal(absenceWindow({ start_date: "2026-03-28", end_date: "2026-03-30" }, now).days, 3);
  assert.equal(absenceWindow({ start_date: "2026-10-24", end_date: "2026-10-26" }, now).days, 3);
  assert.equal(absenceWindow({ start_date: "2026-12-31", end_date: "2027-01-01" }, now).days, 2);
  assert.equal(absenceWindow({ start_date: "2026-03-01", end_date: "2026-03-14" }, now).days, 14);
  assert.deepEqual(absenceWindow({ end_date: "2026-03-02" }, now), {
    start_date: "2026-03-01",
    end_date: "2026-03-02",
    days: 2,
    full_day: true,
  });
});

test("part of a day keeps local wall-clock times untouched, also on a DST day", () => {
  assert.deepEqual(
    absenceWindow(
      { start_date: "2026-10-25", from_time: "02:30", to_time: "11:45" },
      new Date("2026-10-01T12:00:00Z"),
    ),
    {
      start_date: "2026-10-25",
      end_date: "2026-10-25",
      days: 1,
      full_day: false,
      from_time: "02:30",
      to_time: "11:45",
    },
  );
});

test("invalid windows fail with one bilingual message naming the rules", () => {
  const now = new Date("2026-09-21T10:00:00Z");
  for (const input of [
    { start_date: "2026-09-20" },
    { start_date: "2026-9-21" },
    { start_date: "2026-02-30" },
    { start_date: "2026-09-21T00:00:00Z" },
    { start_date: "" },
    { start_date: "2026-09-22", end_date: "2026-09-21" },
    { start_date: "2026-09-22", end_date: "nope" },
    { end_date: "2026-09-20" },
    { start_date: "2026-09-21", end_date: "2026-10-05" },
    { from_time: "10:00" },
    { to_time: "10:00" },
    { from_time: "10:00", to_time: "10:00" },
    { from_time: "12:00", to_time: "10:00" },
    { from_time: "9:00", to_time: "10:00" },
    { from_time: "09:00", to_time: "24:00" },
    { from_time: "09:00", to_time: "10:60" },
    { start_date: "2026-09-21", end_date: "2026-09-22", from_time: "09:00", to_time: "10:00" },
  ]) {
    assert.throws(
      () => absenceWindow(input, now),
      (e: unknown) => {
        hasKey("absence_window")(e);
        const en = describeError(e, "en", "mcp");
        assert.equal(en.kind, "input");
        assert.match(en.message, /at most 14 days/);
        assert.match(describeError(e, "sv", "cli").message, /högst 14 dagar/);
        return true;
      },
      JSON.stringify(input),
    );
  }
});

// ----- the switch -----

test("allowWrites is off unless a source says yes; nonsense is an error, never 'on'", () => {
  const resolve = (env: Record<string, string>, file: { allowWrites?: boolean | string } = {}) =>
    resolveConfig([envSource(env), { school: "testskola", ...file }], {
      home: "/home/synthetic",
      platform: "linux",
    }).allowWrites;
  assert.equal(resolve({}), false);
  assert.equal(resolve({ SCHOOLSOFT_ALLOW_WRITES: "" }), false);
  for (const yes of ["1", "true", "YES", " on "])
    assert.equal(resolve({ SCHOOLSOFT_ALLOW_WRITES: yes }), true, yes);
  for (const no of ["0", "false", "No", "off"])
    assert.equal(resolve({ SCHOOLSOFT_ALLOW_WRITES: no }, { allowWrites: true }), false, no);
  assert.equal(resolve({}, { allowWrites: true }), true);
  assert.equal(resolve({}, { allowWrites: false }), false);
  assert.equal(resolve({}, { allowWrites: "true" }), true);
  assert.throws(() => resolve({ SCHOOLSOFT_ALLOW_WRITES: "maybe" }), /not a switch/);
});

test("with writes off the operation fails before touching the session, preview included", async () => {
  const { ctx, notices } = await writableContext(false);
  for (const args of [{}, { confirm: true }, { start_date: "bad" }]) {
    await assert.rejects(reportAbsence.run(ctx, args), (e: unknown) => {
      hasKey("writes_disabled")(e);
      const en = describeError(e, "en", "mcp");
      assert.equal(en.kind, "not_available");
      assert.equal(en.exitCode, 5);
      assert.equal(en.retryable, false);
      assert.match(en.message, /report_absence .* switched off/);
      assert.match(en.hint ?? "", /SCHOOLSOFT_ALLOW_WRITES=1/);
      assert.match(describeError(e, "en", "cli").hint ?? "", /allowWrites/);
      const sv = describeError(e, "sv", "cli");
      assert.match(sv.message, /avstängda/);
      assert.match(sv.hint ?? "", /SCHOOLSOFT_ALLOW_WRITES=1/);
      assert.match(describeError(e, "sv", "mcp").hint ?? "", /starta om/);
      return true;
    });
  }
  assert.equal(notices.length, 0);
});

test("the operation is annotated as a non-idempotent, destructive write that needs a session", () => {
  assert.deepEqual(reportAbsence.annotations, {
    readOnly: false,
    destructive: true,
    idempotent: false,
    requiresAuth: true,
  });
  assert.deepEqual(reportAbsence.portal, ["reportAbsence"]);
  assert.deepEqual(WRITE_CAPABILITIES, ["reportAbsence"]);
  assert.deepEqual(ROUTING.reportAbsence, ["api"]);
});

// ----- preview and send -----

test("without confirm it previews what would be reported and sends nothing", async () => {
  const { ctx, manager, notices } = await writableContext();
  await assert.rejects(reportAbsence.run(ctx, { start_date: "bad" }), hasKey("absence_window"));
  await assert.rejects(reportAbsence.run(ctx, { child: "Två" }), /Not logged in/);
  await manager.login();
  const today = stockholmToday();

  for (const confirm of [undefined, false]) {
    const preview = await reportAbsence.run(ctx, { child: "två", reason: "  Feber ", confirm });
    assert.deepEqual(preview, {
      status: "preview",
      child: { studentId: 101, firstName: "Två" },
      start_date: today,
      end_date: today,
      days: 1,
      full_day: true,
      reason: "Feber",
      timezone: "Europe/Stockholm",
      summary: `Report Två T absent ${today}, the whole day. Reason: Feber.`,
    });
  }
  const partDay = await reportAbsence.run(ctx, {
    child_id: 100,
    from_time: "10:00",
    to_time: "12:00",
    reason: "   ",
  });
  assert.equal(partDay.summary, `Report Ett T absent ${today} from 10:00 to 12:00.`);
  assert.equal("reason" in partDay, false);
  const range = await reportAbsence.run(ctx, {
    child: "ett t",
    child_id: 100,
    start_date: today,
    end_date: addDays(today, 2),
  });
  assert.match(range.summary, /\(3 days\), whole days\.$/);

  assert.equal(notices.length, 0, "a preview never reaches the portal");
  assert.equal(manager.guardian().childInFocus, 100, "a preview does not switch child");
});

function addDays(date: string, days: number): string {
  return new Date(Date.parse(date + "T00:00:00Z") + days * 86_400_000).toISOString().slice(0, 10);
}

test("the child must be unambiguous: a report never falls back to the child in focus", async () => {
  const { ctx, manager, strategy, notices } = await writableContext();
  await manager.login();
  await assert.rejects(reportAbsence.run(ctx, { confirm: true }), (e: unknown) => {
    hasKey("absence_child_required")(e);
    assert.match(describeError(e, "en", "mcp").message, /Ett \(100\), Två \(101\)/);
    assert.match(describeError(e, "sv", "mcp").message, /inget antas/);
    assert.match(describeError(e, "en", "mcp").hint ?? "", /list_children/);
    return true;
  });
  for (const args of [
    { child: "Tre" },
    { child: "T" },
    { child: "Två", child_id: 100 },
    { child: "Två", child_id: 999 },
  ]) {
    await assert.rejects(reportAbsence.run(ctx, { ...args, confirm: true }), (e: unknown) => {
      hasKey("child_name_not_found")(e);
      assert.match(describeError(e, "sv", "cli").message, /exakt ett barn/);
      return true;
    });
  }
  await assert.rejects(reportAbsence.run(ctx, { child_id: 999 }), hasKey("child_not_found"));

  strategy.context = { ...CONTEXT, children: [] };
  await assert.rejects(reportAbsence.run(ctx, {}), (e: unknown) => {
    hasKey("absence_child_required")(e);
    assert.match(describeError(e, "en", "cli").message, /Children: none/);
    return true;
  });
  strategy.context = { ...CONTEXT, children: [CONTEXT.children[0]] };
  assert.equal((await reportAbsence.run(ctx, {})).child.studentId, 100);
  assert.equal(notices.length, 0);
});

test("confirm focuses the child and hands the portal exactly one notice", async () => {
  const { ctx, manager, notices } = await writableContext();
  await manager.login();
  const today = stockholmToday();
  const result = await reportAbsence.run(ctx, {
    child: "Två T",
    reason: "Feber",
    confirm: true,
  });
  assert.equal(result.status, "reported");
  assert.deepEqual(result.response, { synthetic: true });
  assert.equal(result.child.studentId, 101);
  assert.equal(manager.guardian().childInFocus, 101);
  assert.deepEqual(notices, [
    { studentId: 101, startDate: today, endDate: today, fullDay: true, reason: "Feber" },
  ]);

  await reportAbsence.run(ctx, {
    child_id: 100,
    start_date: today,
    from_time: "08:00",
    to_time: "09:30",
    confirm: true,
  });
  assert.deepEqual(notices[1], {
    studentId: 100,
    startDate: today,
    endDate: today,
    fullDay: false,
    fromTime: "08:00",
    toTime: "09:30",
  });
  assert.equal(notices.length, 2);
});

// ----- provider: one POST, the unverified body, failures that do not invite a repeat -----

const fullDay: AbsenceNotice = {
  studentId: 101,
  startDate: "2026-09-21",
  endDate: "2026-09-22",
  fullDay: true,
};
const partDay: AbsenceNotice = {
  studentId: 100,
  startDate: "2026-09-21",
  endDate: "2026-09-21",
  fullDay: false,
  fromTime: "10:00",
  toTime: "12:00",
  reason: "Tandläkare",
};

function apiFixture(
  answer: (n: number) => { status: number; data: unknown },
  cookie = "JSESSIONID=synthetic",
) {
  const requests: { url: string; options: Parameters<ApiFetch>[2] }[] = [];
  const fetchImpl: ApiFetch = async (url, _school, options) => {
    requests.push({ url, options });
    return answer(requests.length);
  };
  const api = new ApiPortal({
    school: "testskola",
    accessToken: () => null,
    cookieHeader: () => cookie || null,
    fetchImpl,
  });
  return { api, requests };
}

test("the request body mapper (unverified shape) maps whole and part days", () => {
  assert.deepEqual(toAbsenceNoticeBody(fullDay), {
    studentId: 101,
    fromDate: "2026-09-21",
    toDate: "2026-09-22",
    fullDay: true,
  });
  assert.deepEqual(toAbsenceNoticeBody(partDay), {
    studentId: 100,
    fromDate: "2026-09-21",
    toDate: "2026-09-21",
    fullDay: false,
    fromTime: "10:00",
    toTime: "12:00",
    comment: "Tandläkare",
  });
});

test("reportAbsence sends exactly one cookie-authenticated POST with the mapped body", async () => {
  for (const status of [200, 201, 204, 299]) {
    const f = apiFixture(() => ({ status, data: status === 204 ? null : { id: 1 } }));
    assert.deepEqual(await f.api.reportAbsence(partDay), {
      status,
      response: status === 204 ? null : { id: 1 },
    });
    assert.equal(f.requests.length, 1);
    const [{ url, options }] = f.requests;
    assert.equal(new URL(url).pathname, "/testskola/rest-api/parent/absence-notice");
    assert.equal(options.method, "POST");
    assert.equal(options.followRedirects, false, "the HTTP helper must not re-issue the POST");
    assert.equal(options.headers?.Cookie, "JSESSIONID=synthetic");
    assert.equal(options.headers?.Authorization, undefined);
    assert.match(options.headers?.["Content-Type"] ?? "", /application\/json/);
    assert.deepEqual(JSON.parse(options.body ?? ""), toAbsenceNoticeBody(partDay));
  }
});

test("without session cookies nothing is sent", async () => {
  const f = apiFixture(() => ({ status: 200, data: null }), "");
  await assert.rejects(f.api.reportAbsence(fullDay), hasKey("not_authenticated"));
  assert.equal(f.requests.length, 0);
});

test("upstream failures become AgentErrors that never invite a blind repeat", async () => {
  for (const status of [199, 302, 400, 404, 409, 422]) {
    const f = apiFixture(() => ({ status, data: null }));
    await assert.rejects(f.api.reportAbsence(fullDay), (e: unknown) => {
      hasKey("absence_rejected")(e);
      const en = describeError(e, "en", "cli");
      assert.equal(en.kind, "upstream");
      assert.equal(en.retryable, false);
      assert.match(en.message, new RegExp(`HTTP ${status}`));
      assert.match(describeError(e, "sv", "cli").message, /avvisade frånvaroanmälan/);
      return true;
    });
    assert.equal(f.requests.length, 1);
  }
  for (const status of [500, 502, 503]) {
    const f = apiFixture(() => ({ status, data: null }));
    await assert.rejects(f.api.reportAbsence(fullDay), (e: unknown) => {
      hasKey("write_outcome_unknown")(e);
      const en = describeError(e, "en", "mcp");
      assert.equal(en.kind, "upstream");
      assert.equal(en.retryable, false, "a 5xx on a write is not 'try again'");
      assert.match(en.message, new RegExp(`HTTP ${status}.*not known whether the absence report`));
      assert.match(en.hint ?? "", /Do not call again on your own/);
      assert.match(describeError(e, "sv", "mcp").message, /okänt om/);
      assert.match(describeError(e, "sv", "cli").hint ?? "", /två gånger/);
      assert.match(describeError(e, "en", "cli").hint ?? "", /twice/);
      return true;
    });
    assert.equal(f.requests.length, 1);
  }
  for (const status of [401, 403]) {
    const f = apiFixture(() => ({ status, data: null }));
    await assert.rejects(f.api.reportAbsence(fullDay), (e: unknown) => {
      assert.ok(e instanceof UpstreamError);
      assert.equal(e.sessionRejected, true);
      return true;
    });
    assert.equal(f.requests.length, 1);
  }
});

test("a transport failure after a possible send is 'outcome unknown', not a retryable network error", async () => {
  let sent = 0;
  const api = new ApiPortal({
    school: "testskola",
    accessToken: () => null,
    cookieHeader: () => "JSESSIONID=synthetic",
    fetchImpl: async () => {
      sent++;
      throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
    },
  });
  await assert.rejects(api.reportAbsence(fullDay), (e: unknown) => {
    hasKey("write_outcome_unknown")(e);
    const en = describeError(e, "en", "cli");
    assert.equal(en.kind, "network");
    assert.equal(en.exitCode, 4);
    assert.equal(en.retryable, false);
    assert.match(en.message, /ECONNRESET/);
    return true;
  });
  assert.equal(sent, 1);

  const bug = new ApiPortal({
    school: "testskola",
    accessToken: () => null,
    cookieHeader: () => "JSESSIONID=synthetic",
    fetchImpl: async () => {
      throw new TypeError("synthetic bug");
    },
  });
  await assert.rejects(bug.reportAbsence(fullDay), TypeError);
});

// ----- session recovery must not double-send -----

function recoveringStack(
  answer: (n: number) => { status: number; data: unknown },
  recover: () => Promise<void>,
) {
  const f = apiFixture(answer);
  const portal = withSessionRecovery(
    createCompositePortal({
      routing: ROUTING,
      providerId: "schoolsoft",
      api: f.api,
      browser: null,
    }),
    { recover },
  );
  return { portal, requests: f.requests };
}

test("a rejected session renews the session but the POST is not sent a second time", async () => {
  for (const status of [401, 403]) {
    let recovered = 0;
    const s = recoveringStack(
      (n) => (n === 1 ? { status, data: null } : { status: 200, data: { wouldDuplicate: true } }),
      async () => {
        recovered++;
      },
    );
    const base = makeContext({ config: { allowWrites: true }, portal: s.portal });
    await base.manager.login();
    await assert.rejects(
      reportAbsence.run(base.ctx, { child_id: 100, confirm: true }),
      (e: unknown) => {
        hasKey("write_not_repeated")(e);
        assert.ok((e as AgentError).cause instanceof UpstreamError);
        const en = describeError(e, "en", "mcp");
        assert.equal(en.kind, "upstream");
        assert.equal(en.retryable, false);
        assert.match(en.message, /not sent again/);
        assert.match(en.hint ?? "", /only if they ask/);
        assert.match(describeError(e, "en", "cli").hint ?? "", /--confirm/);
        assert.match(describeError(e, "sv", "cli").message, /inte igen/);
        assert.match(describeError(e, "sv", "cli").hint ?? "", /--confirm/);
        assert.match(describeError(e, "sv", "mcp").hint ?? "", /confirm: true/);
        return true;
      },
    );
    assert.equal(recovered, 1, "the session is renewed for the user's next call");
    assert.equal(s.requests.length, 1, "exactly one POST reached the network");
  }
});

test("a failed recovery propagates, still with a single POST; a clean send needs no recovery", async () => {
  const failing = recoveringStack(
    () => ({ status: 401, data: null }),
    async () => {
      throw new Error("no saved session");
    },
  );
  await assert.rejects(failing.portal.reportAbsence(fullDay), /no saved session/);
  assert.equal(failing.requests.length, 1);

  const clean = recoveringStack(
    () => ({ status: 201, data: { id: 7 } }),
    async () => assert.fail("must not recover"),
  );
  assert.deepEqual(await clean.portal.reportAbsence(fullDay), { status: 201, response: { id: 7 } });
  assert.equal(clean.requests.length, 1);

  const unknown = recoveringStack(
    () => ({ status: 503, data: null }),
    async () => assert.fail("must not recover"),
  );
  await assert.rejects(unknown.portal.reportAbsence(fullDay), hasKey("write_outcome_unknown"));
  assert.equal(unknown.requests.length, 1);
});

// ----- the parent-hosted connector stays read-only -----

test("the HTTP connector offers no write: every operation it lists is read-only, report_absence is absent", () => {
  const listed: readonly string[] = CONNECTOR_OPERATIONS;
  assert.equal(listed.includes("report_absence"), false);
  for (const name of listed) {
    const op = operations.find((o) => o.name === name);
    assert.equal(op?.annotations.readOnly, true, name);
    assert.equal(op?.annotations.destructive, false, name);
  }
});
