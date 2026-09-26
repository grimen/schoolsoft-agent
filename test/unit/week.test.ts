/** The week model: ISO weeks named by their Stockholm dates, one rule for every operation. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isoWeekOfDate, weekOf, weekOfDate } from "../../src/core/operations/_week.js";
import { isoWeek } from "../../src/core/operations/_shared.js";
import { stockholmToday } from "../../src/core/operations/_calendar-range.js";
import { InputError } from "../../src/core/errors/index.js";

const at = (iso: string) => new Date(iso);

test("an ISO week number from a date: Sunday ends its week, years turn on Thursdays", () => {
  assert.equal(isoWeekOfDate("2026-09-06"), 36, "Sunday");
  assert.equal(isoWeekOfDate("2026-09-07"), 37, "Monday");
  assert.equal(isoWeekOfDate("2026-12-31"), 53);
  assert.equal(isoWeekOfDate("2027-01-03"), 53, "still 2026's last week");
  assert.equal(isoWeekOfDate("2027-01-04"), 1);
  assert.equal(isoWeekOfDate("2024-12-30"), 1, "already 2025's first week");
});

test("a week number resolves to the year it starts nearest today, with its Stockholm dates", () => {
  assert.deepEqual(weekOf(39, at("2026-09-26T10:00:00Z")), {
    year: 2026,
    week: 39,
    startDate: "2026-09-21",
    endDate: "2026-09-27",
  });
  assert.deepEqual(weekOf(2, at("2026-12-15T12:00:00Z")), {
    year: 2027,
    week: 2,
    startDate: "2027-01-11",
    endDate: "2027-01-17",
  });
  assert.equal(weekOf(52, at("2027-01-05T12:00:00Z")).year, 2026);
  assert.throws(
    () => weekOf(53, at("2029-06-01T12:00:00Z")),
    (e: unknown) => e instanceof InputError && /week 53 does not exist/.test(e.message),
  );
});

test("the current week is Stockholm's, whatever the server's zone", () => {
  // Monday 2026-09-21 00:30 in Stockholm is still Sunday 22:30 in UTC.
  const mondayNight = at("2026-09-20T22:30:00Z");
  assert.equal(weekOf(undefined, mondayNight).week, 39);
  assert.equal(weekOf(undefined, mondayNight).startDate, "2026-09-21");
  assert.equal(isoWeek(mondayNight), 39);
  assert.equal(isoWeek(at("2026-09-20T21:30:00Z")), 38, "Sunday 23:30 in Stockholm");
  assert.equal(typeof weekOf().week, "number", "defaults to now");
  assert.equal(typeof isoWeek(), "number");
});

test("a date names its ISO week, but only one the week number alone maps back to", () => {
  const now = at("2026-09-26T10:00:00Z");
  assert.deepEqual(weekOfDate("2026-09-26", now), {
    year: 2026,
    week: 39,
    startDate: "2026-09-21",
    endDate: "2026-09-27",
  });
  assert.deepEqual(weekOfDate("2027-01-02", at("2026-12-20T10:00:00Z")), {
    year: 2026,
    week: 53,
    startDate: "2026-12-28",
    endDate: "2027-01-03",
  });
  assert.equal(weekOfDate("2027-02-01", now).year, 2027, "four months ahead is fine");
  for (const date of ["2026-02-30", "26-09-26", "2026-9-26", "", "2026-09-26T00:00"])
    assert.throws(
      () => weekOfDate(date, now),
      (e: unknown) => e instanceof InputError && /real YYYY-MM-DD date/.test(e.message),
      date,
    );
  // Week 18 of 2027 would be read as week 18 of 2026 (nearer today): refused, not misread.
  assert.throws(
    () => weekOfDate("2027-05-03", now),
    (e: unknown) => e instanceof InputError && /too far from today/.test(e.message),
  );
  assert.throws(() => weekOfDate("2025-09-26", now), /too far from today/);
  assert.equal(weekOfDate(stockholmToday()).week, weekOf().week, "defaults to now");
});
