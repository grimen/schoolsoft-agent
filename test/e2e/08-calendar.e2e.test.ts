/** Optional live probe: counts only, manual existing login; no payloads in logs. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { getOperation } from "../../src/core/index.js";
import { skip, e2eContext, record } from "./helpers.js";

test(
  "calendar: both agenda sources for an explicitly selected range",
  {
    skip:
      skip ||
      (!process.env.SCHOOLSOFT_CALENDAR_START || !process.env.SCHOOLSOFT_CALENDAR_END
        ? "set SCHOOLSOFT_CALENDAR_START and SCHOOLSOFT_CALENDAR_END after manual login"
        : false),
  },
  async () => {
    let result: { entries: { source: string }[]; timezone: string };
    try {
      result = (await getOperation("get_calendar")!.run(e2eContext(), {
        start_date: process.env.SCHOOLSOFT_CALENDAR_START,
        end_date: process.env.SCHOOLSOFT_CALENDAR_END,
      })) as typeof result;
    } catch {
      assert.fail("Calendar read failed. Check the session and date range privately.");
    }
    assert.equal(result.timezone, "Europe/Stockholm");
    assert.ok(Array.isArray(result.entries));
    const lessons = result.entries.filter((entry) => entry.source === "lessons").length;
    const events = result.entries.filter((entry) => entry.source === "events").length;
    assert.equal(lessons + events, result.entries.length);
    record(
      "calendar",
      "Agenda response counts (visual and end-date comparison still required)",
      `lessons=${lessons}; events=${events}`,
    );
  },
);
