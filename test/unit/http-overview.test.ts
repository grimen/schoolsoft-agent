/** The overview's pure parts: the next event, section assembly and the second child check. */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { CalendarEvent, GuardianChild } from "../../src/core/index.js";
import { stockholmToday, weekOf } from "../../src/core/index.js";
import { ConnectorRefusedError, type ChildRead } from "../../src/http/runtime.js";
import {
  NEXT_EVENT_DAYS,
  OVERVIEW_SCOPES,
  buildOverview,
  keptInSection,
  nextEvent,
} from "../../src/http/overview.js";
import { UpstreamError, NotAuthenticatedError } from "../../src/core/index.js";

const event = (
  id: string,
  start: string,
  end: string,
  kind: CalendarEvent["kind"] = "event",
): CalendarEvent => ({
  id,
  kind,
  title: id,
  allDay: start.length === 10,
  start,
  end,
  location: null,
  teacher: null,
  group: null,
  category: null,
  note: null,
});

test("the next event: school events only, not yet ended, dates before times of the same day", () => {
  const now = Date.parse("2026-09-26T10:00:00+02:00");
  const today = "2026-09-26";
  assert.equal(nextEvent([], today, now), null);
  const events = [
    event("lesson", "2026-09-26T11:00:00+02:00", "2026-09-26T12:00:00+02:00", "lesson"),
    event("ended-earlier-today", "2026-09-26T08:00:00+02:00", "2026-09-26T09:59:00+02:00"),
    event("yesterday", "2026-09-25", "2026-09-25"),
    event("later-today", "2026-09-26T13:00:00+02:00", "2026-09-26T14:00:00+02:00"),
    event("all-day-today", "2026-09-26", "2026-09-26"),
    event("running-since-yesterday", "2026-09-25", "2026-09-27"),
  ];
  assert.equal(nextEvent(events, today, now)!.id, "running-since-yesterday");
  assert.equal(nextEvent(events.slice(0, 5), today, now)!.id, "all-day-today");
  assert.equal(nextEvent(events.slice(0, 4), today, now)!.id, "later-today");
  assert.equal(nextEvent(events.slice(0, 3), today, now), null);
  const tie = [
    event("first", "2026-10-01", "2026-10-01"),
    event("second", "2026-10-01", "2026-10-01"),
  ];
  assert.equal(nextEvent(tie, today, now)!.id, "first", "ties keep the calendar's order");
});

test("which failures stay in their section", () => {
  assert.equal(keptInSection(new UpstreamError(500, "lunch")), true);
  assert.equal(
    keptInSection(new Error("a bug")),
    true,
    "one section's bug does not blank the rest",
  );
  assert.equal(keptInSection(new NotAuthenticatedError("gone")), false);
  assert.equal(keptInSection(new ConnectorRefusedError("child", "no")), false);
  assert.deepEqual(OVERVIEW_SCOPES, ["get_schedule", "get_lunch_menu", "get_calendar"]);
  assert.equal(NEXT_EVENT_DAYS, 30);
});

const child: GuardianChild = {
  studentId: 7,
  firstName: "Synthetic",
  lastName: "Child",
  schools: [{ orgId: 1, name: "School", className: "1A" }],
};

test("a section answered for another child fails the whole overview", async () => {
  const now = Date.now();
  const week = weekOf();
  let asked: ChildRead[] = [];
  const request = (answeredFor: number) =>
    buildOverview({
      childId: 7,
      input: { fresh: false },
      scopes: ["get_schedule"],
      now,
      read: async (reads) => {
        asked = reads;
        return {
          child,
          results: [
            {
              ok: true,
              value: {
                ...week,
                child: { id: answeredFor, firstName: "Synthetic" },
                lessons: [],
              },
            },
          ],
        };
      },
      problem: () => {
        throw new Error("no problem expected");
      },
    });
  const overview = await request(7);
  assert.deepEqual(asked, [{ name: "get_schedule", args: { week: week.week, fresh: false } }]);
  assert.deepEqual(overview.child, {
    id: 7,
    firstName: "Synthetic",
    schoolName: "School",
    className: "1A",
  });
  assert.equal(overview.week.today, stockholmToday(new Date(now)));
  await assert.rejects(
    request(8),
    (e: unknown) => e instanceof ConnectorRefusedError && e.reason === "child_changed",
  );
});
