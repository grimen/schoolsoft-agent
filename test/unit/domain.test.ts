/**
 * The domain model's time rules and the SchoolSoft mappers, branch by branch:
 * Stockholm offsets across both DST changes, the accepted timestamp forms,
 * ISO weeks, and every lenient-or-drift decision the raw schemas make.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  instantToStockholm,
  isoWeekDate,
  isoWeekYear,
  isoWeeksInYear,
  nearestWeekYear,
  stockholmOffsetMinutes,
  toLocalDate,
  toStockholmDateTime,
  wallClockToStockholm,
} from "../../src/core/domain/time.js";
import { LessonSchema, MessageSchema } from "../../src/core/domain/schemas.js";
import { ResponseDriftError } from "../../src/core/errors/index.js";
import { lunchYear } from "../../src/core/operations/get-lunch-menu.js";
import { toChild } from "../../src/core/operations/list-children.js";
import { toGuardianParent } from "../../src/providers/schoolsoft/portal/domain/parent.js";
import { toLessons } from "../../src/providers/schoolsoft/portal/domain/lessons.js";
import { toCalendarEvents } from "../../src/providers/schoolsoft/portal/domain/agenda.js";
import { toLunchDays } from "../../src/providers/schoolsoft/portal/domain/lunch.js";
import { toMessages } from "../../src/providers/schoolsoft/portal/domain/inbox.js";
import { rawInbox, rawLessonsWeek, rawParent } from "../helpers/portal-json.js";

test("Stockholm offsets: +01:00 in winter, +02:00 in summer, whatever the host's timezone", () => {
  assert.equal(stockholmOffsetMinutes(Date.UTC(2026, 0, 15, 12)), 60);
  assert.equal(stockholmOffsetMinutes(Date.UTC(2026, 6, 15, 12)), 120);
  assert.equal(
    instantToStockholm(Date.UTC(2026, 8, 7, 6, 30, 0, 999)),
    "2026-09-07T08:30:00+02:00",
  );
  assert.equal(instantToStockholm(Date.UTC(2026, 11, 31, 23, 30)), "2027-01-01T00:30:00+01:00");
});

test("wall-clock times: the autumn fold takes the summer instant, the spring gap the winter offset", () => {
  // 2026-10-25 02:30 happens twice; 2026-03-29 02:30 never happens.
  assert.equal(wallClockToStockholm(Date.UTC(2026, 9, 25, 2, 30)), "2026-10-25T02:30:00+02:00");
  assert.equal(wallClockToStockholm(Date.UTC(2026, 9, 25, 3, 30)), "2026-10-25T03:30:00+01:00");
  assert.equal(wallClockToStockholm(Date.UTC(2026, 2, 29, 2, 30)), "2026-03-29T02:30:00+01:00");
  assert.equal(wallClockToStockholm(Date.UTC(2026, 2, 29, 3, 30)), "2026-03-29T03:30:00+02:00");
});

test("timestamps: T or space, optional seconds and fraction, local or with an offset; invalid ones are null", () => {
  for (const [input, expected] of [
    ["2026-09-07T08:30", "2026-09-07T08:30:00+02:00"],
    ["2026-09-07 08:30", "2026-09-07T08:30:00+02:00"],
    [" 2026-09-07T08:30:15 ", "2026-09-07T08:30:15+02:00"],
    ["2026-01-07T08:30:15.123", "2026-01-07T08:30:15+01:00"],
    ["2026-09-07T06:30:00Z", "2026-09-07T08:30:00+02:00"],
    ["2026-09-07T08:30:00+02:00", "2026-09-07T08:30:00+02:00"],
    ["2026-09-07T01:30:00-0500", "2026-09-07T08:30:00+02:00"],
  ]) {
    assert.equal(toStockholmDateTime(input), expected, input);
  }
  for (const bad of ["2026-02-30T10:00", "2026-09-07T24:00", "2026-09-07", "yesterday", "0"]) {
    assert.equal(toStockholmDateTime(bad), null, bad);
  }
  assert.equal(toLocalDate("2028-02-29"), "2028-02-29");
  assert.equal(toLocalDate("2026-02-29"), null);
  assert.equal(toLocalDate("2026-09-07T08:00"), null);
});

test("ISO weeks: dates, 52/53-week years, week-years across new year, and the nearest year", () => {
  assert.equal(isoWeekDate(2026, 37, 1), "2026-09-07");
  assert.equal(isoWeekDate(2026, 53, 5), "2027-01-01");
  assert.equal(isoWeekDate(2027, 1, 1), "2027-01-04");
  assert.equal(isoWeeksInYear(2026), 53);
  assert.equal(isoWeeksInYear(2027), 52);
  assert.equal(isoWeekYear("2027-01-01"), 2026);
  assert.equal(isoWeekYear("2024-12-30"), 2025);
  assert.equal(nearestWeekYear(2, "2026-12-15"), 2027);
  assert.equal(nearestWeekYear(50, "2027-01-10"), 2026);
  assert.equal(nearestWeekYear(37, "2026-09-26"), 2026);
  assert.equal(nearestWeekYear(53, "2026-06-01"), 2026);
  assert.equal(nearestWeekYear(53, "2029-06-01"), null);
  assert.equal(lunchYear(2, new Date("2026-12-15T12:00:00Z")), 2027);
  assert.throws(() => lunchYear(53, new Date("2029-06-01T12:00:00Z")), /week 53 does not exist/);
  assert.equal(typeof lunchYear(10), "number", "defaults to today");
});

test("guardian profile: extra fields dropped, absent last names and class names tolerated", () => {
  const raw = rawParent();
  const parent = toGuardianParent(raw);
  assert.deepEqual(Object.keys(parent.children[0]).sort(), [
    "firstName",
    "lastName",
    "schools",
    "studentId",
  ]);
  const sparse = toGuardianParent({
    userId: 1,
    firstName: "P",
    lastName: null,
    children: [{ studentId: 2, firstName: "C", schools: [{ orgId: 3, name: "S" }] }],
  });
  assert.deepEqual(sparse, {
    userId: 1,
    firstName: "P",
    lastName: "",
    children: [
      {
        studentId: 2,
        firstName: "C",
        lastName: "",
        schools: [{ orgId: 3, name: "S", className: "" }],
      },
    ],
  });
  assert.deepEqual(toChild(sparse.children[0]), {
    id: 2,
    firstName: "C",
    schoolName: "S",
    className: null,
  });
  assert.throws(() => toGuardianParent(null), ResponseDriftError);
});

test("lessons: string ids, blank text becomes null, the result satisfies the domain schema", () => {
  const [first] = toLessons([
    { ...rawLessonsWeek()[0], eventId: "abc", room: "  ", teacher: undefined },
  ]);
  assert.equal(first.id, "lesson:abc@2026-09-07T08:30:00+02:00");
  assert.equal(first.room, null);
  assert.equal(first.teacher, null);
  assert.ok(LessonSchema.safeParse(first).success);
  assert.throws(
    () => toLessons([{ ...rawLessonsWeek()[0], eventId: "" }]),
    (e: unknown) => e instanceof ResponseDriftError && e.where === "getScheduleWeek",
  );
});

test("agenda: a value that is neither a date nor a date-time is drift", () => {
  const entry = {
    eventId: 1,
    name: "E",
    startDate: "2026-09-07",
    endDate: "2026-09-07",
    allDay: true,
  };
  assert.equal(toCalendarEvents([entry], "event")[0].start, "2026-09-07");
  assert.throws(
    () => toCalendarEvents([{ ...entry, endDate: "soon" }], "event"),
    (e: unknown) =>
      e instanceof ResponseDriftError && /endDate not a date or date-time/.test(e.detail),
  );
});

test("lunch: meal types as text, numbers, blank or absent", () => {
  const days = toLunchDays(
    [
      {
        week: 37,
        dayId: 3,
        dishes: [
          { mealType: 2, description: "a" },
          { mealType: "", description: "b" },
          { mealType: null, description: "c" },
          { description: "d" },
        ],
      },
    ],
    2026,
    37,
  );
  assert.deepEqual(days, [
    {
      date: "2026-09-09",
      weekday: 3,
      dishes: [
        { kind: "2", description: "a" },
        { kind: null, description: "b" },
        { kind: null, description: "c" },
        { kind: null, description: "d" },
      ],
    },
  ]);
});

test("inbox: epoch dates, missing previews, senders without a name or without a sender at all", () => {
  const base = rawInbox()[0];
  const [epoch, nameless, firstOnly, none] = toMessages([
    { ...base, date: Date.UTC(2026, 0, 5, 7), message: null },
    { ...base, sender: { id: 1, firstName: null, lastName: "" } },
    { ...base, sender: { id: 2, firstName: "Only", lastName: null } },
    { ...base, sender: null },
  ]);
  assert.equal(epoch.sentAt, "2026-01-05T08:00:00+01:00");
  assert.equal(epoch.preview, "");
  assert.equal(nameless.sender, null);
  assert.deepEqual(firstOnly.sender, { name: "Only" });
  assert.equal(none.sender, null);
  for (const m of [epoch, nameless, none]) assert.ok(MessageSchema.safeParse(m).success);
  assert.throws(
    () => toMessages([{ ...base, date: "last Tuesday" }]),
    (e: unknown) => e instanceof ResponseDriftError && /0\.date/.test(e.detail),
  );
});
