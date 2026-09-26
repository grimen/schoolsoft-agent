import { test } from "node:test";
import assert from "node:assert/strict";
import { calendarRange } from "../../src/core/operations/_calendar-range.js";
import { getCalendar } from "../../src/core/operations/get-calendar.js";
import { AgentError, describeError } from "../../src/core/index.js";
import { ApiPortal } from "../../src/providers/schoolsoft/portal/api-portal.js";
import { makeContext } from "../helpers/fakes.js";

const lesson = {
  eventId: 1,
  name: "Maths",
  startDate: "2026-09-07T09:00",
  endDate: "2026-09-07T10:00",
  allDay: false,
  room: "A1",
};

test("calendar ranges use Stockholm weeks across midnight, DST and year boundaries", () => {
  for (const [now, start, end] of [
    ["2026-09-06T22:30:00Z", "2026-09-07", "2026-09-13"],
    ["2026-09-06T21:30:00Z", "2026-08-31", "2026-09-06"],
    ["2026-03-29T22:30:00Z", "2026-03-30", "2026-04-05"],
    ["2026-10-25T22:30:00Z", "2026-10-19", "2026-10-25"],
    ["2026-10-25T23:30:00Z", "2026-10-26", "2026-11-01"],
    ["2027-01-01T12:00:00Z", "2026-12-28", "2027-01-03"],
  ]) {
    assert.deepEqual(calendarRange(undefined, undefined, new Date(now)), {
      start_date: start,
      end_date: end,
    });
  }
  assert.deepEqual(calendarRange("2028-02-29", "2028-02-29"), {
    start_date: "2028-02-29",
    end_date: "2028-02-29",
  });
  assert.equal(calendarRange("2028-01-01", "2028-12-31").end_date, "2028-12-31");
  assert.equal(calendarRange("2026-12-31", "2027-01-01").end_date, "2027-01-01");
});

test("invalid or incomplete calendar dates fail with bilingual guidance", () => {
  for (const [start, end] of [
    [undefined, "2026-09-01"],
    ["2026-09-01", undefined],
    ["2026-2-01", "2026-09-01"],
    ["2026-02-29", "2026-09-01"],
    ["2026-13-01", "2026-09-01"],
    ["2026-04-31", "2026-09-01"],
    ["2026-09-02", "2026-09-01"],
    ["2028-01-01", "2029-01-01"],
    ["2026-09-01T00:00:00Z", "2026-09-02"],
    ["", ""],
  ]) {
    assert.throws(
      () => calendarRange(start, end),
      (error: unknown) => {
        assert.ok(error instanceof AgentError);
        assert.equal(error.key, "calendar_range");
        assert.match(describeError(error, "en", "cli").message, /366/);
        assert.match(describeError(error, "sv", "mcp").message, /giltiga datum/);
        return true;
      },
    );
  }
});

test("calendar operation validates before auth, defaults dates and scopes the child", async () => {
  const { ctx } = makeContext();
  await assert.rejects(getCalendar.run(ctx, { start_date: "bad" }), /YYYY-MM-DD/);
  await assert.rejects(getCalendar.run(ctx, {}), /Not logged in/);
  await ctx.manager.login();
  const calls: string[][] = [];
  const read = ctx.portal.getCalendar;
  ctx.portal.getCalendar = async (start, end) => {
    calls.push([start, end]);
    return read(start, end);
  };
  const result = await getCalendar.run(ctx, {
    start_date: "2026-09-01",
    end_date: "2026-09-30",
    child_id: 101,
  });
  assert.deepEqual(calls, [["2026-09-01", "2026-09-30"]]);
  assert.equal(result.child.studentId, 101);
  assert.equal(result.start_date, "2026-09-01");
  assert.equal(result.end_date, "2026-09-30");
  assert.equal(result.timezone, "Europe/Stockholm");
  assert.ok(result.entries.length > 0);
  assert.match((await getCalendar.run(ctx, {})).start_date, /^\d{4}-\d{2}-\d{2}$/);
  await assert.rejects(getCalendar.run(ctx, { child_id: 999 }), /No child/);
});

function apiFixture(lessons: unknown, events: unknown, failure?: "lessons" | "event") {
  const calls: string[] = [];
  const api = new ApiPortal({
    school: "taby",
    accessToken: () => null,
    cookieHeader: () => "JSESSIONID=synthetic",
    fetchImpl: async (url, _school, options) => {
      calls.push(url);
      assert.equal(options.headers?.Cookie, "JSESSIONID=synthetic");
      assert.equal(options.headers?.Authorization, undefined);
      const isLesson = url.includes("/lessons/");
      return {
        status: failure === (isLesson ? "lessons" : "event") ? 503 : 200,
        data: isLesson ? lessons : events,
      };
    },
  });
  return { api, calls };
}

test("agenda combines both sources, preserves fields, duplicates and all-day/multiday entries", async () => {
  const event = {
    ...lesson,
    name: "School event",
    description: "Synthetic",
    startDate: "2026-09-06",
    endDate: "2026-09-08",
    allDay: true,
  };
  const lunch = { ...lesson, eventId: 2, name: "Lunch", category: "lunch" };
  const f = apiFixture([lunch, lesson, lesson], [event]);
  const result = await f.api.getCalendar("2026-09-01", "2026-09-30");
  assert.deepEqual(result, [
    { ...event, source: "events" },
    { ...lesson, source: "lessons" },
    { ...lesson, source: "lessons" },
    { ...lunch, source: "lessons" },
  ]);
  assert.deepEqual(
    f.calls.map((url) => new URL(url).pathname + new URL(url).search),
    [
      "/taby/rest-api/parent/calendar/lessons/agenda?start_date=2026-09-01&end_date=2026-09-30",
      "/taby/rest-api/parent/calendar/event/agenda?start_date=2026-09-01&end_date=2026-09-30",
    ],
  );
  assert.deepEqual(await apiFixture([], []).api.getCalendar("2026-09-01", "2026-09-01"), []);
  assert.equal(
    (await apiFixture([lesson], []).api.getCalendar("2026-09-01", "2026-09-01")).length,
    1,
  );
  assert.equal(
    (await apiFixture([], [event]).api.getCalendar("2026-09-01", "2026-09-01")).length,
    1,
  );
});

test("agenda sorting resolves equal starts by end, source, id and name without dropping collisions", async () => {
  const a = { ...lesson, eventId: "a", name: "A" };
  const b = { ...a, name: "B" };
  const earlyEnd = { ...a, endDate: "2026-09-07T09:30" };
  const f = apiFixture([b, a, earlyEnd], [a]);
  assert.deepEqual(await f.api.getCalendar("2026-09-07", "2026-09-07"), [
    { ...earlyEnd, source: "lessons" },
    { ...a, source: "events" },
    { ...a, source: "lessons" },
    { ...b, source: "lessons" },
  ]);
});

test("neither malformed nor failed agenda sources produce a partial calendar", async () => {
  for (const invalid of [
    null,
    {},
    [null],
    [{ ...lesson, eventId: null }],
    [{ ...lesson, name: 3 }],
    [{ ...lesson, allDay: "false" }],
    [{ ...lesson, startDate: "2026-02-30T10:00" }],
    [{ ...lesson, endDate: "yesterday" }],
  ]) {
    for (const source of ["lessons", "events"]) {
      const f = apiFixture(
        source === "lessons" ? invalid : [lesson],
        source === "events" ? invalid : [],
      );
      await assert.rejects(f.api.getCalendar("2026-09-01", "2026-09-30"), (error: unknown) => {
        assert.ok(error instanceof AgentError);
        assert.equal(error.key, "calendar_response");
        assert.match(describeError(error, "sv", "cli").message, /kalendersvar/);
        return true;
      });
      assert.equal(f.calls.length, source === "lessons" ? 1 : 2);
    }
  }
  for (const source of ["lessons", "event"] as const) {
    const f = apiFixture([lesson], [], source);
    await assert.rejects(f.api.getCalendar("2026-09-01", "2026-09-30"), /HTTP 503/);
    assert.equal(f.calls.length, source === "lessons" ? 1 : 2);
  }
});
