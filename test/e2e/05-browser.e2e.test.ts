/**
 * 05 — Browser-backed capabilities against real SchoolSoft, through the
 * production portal (PlaywrightSession with the saved session cookies).
 * Read-only by construction (non-GET aborted). Skips with a reason when the
 * headless browser is not installed (`make browser`). Counts only, no data.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { browserStatus } from "../../src/core/index.js";
import { skip as liveSkip, record, e2eContext } from "./helpers.js";

const status = await browserStatus({ kind: "chromium" });
const skip = liveSkip || (status.ready ? false : `headless browser not installed (${status.hint})`);

test(
  "B1: contacts, subject rooms, bookings, files via the browser provider",
  { skip },
  async () => {
    const ctx = e2eContext();
    await ctx.manager.ensureSession();
    const contacts = await ctx.portal.getContacts();
    assert.ok(Array.isArray(contacts));
    const people = contacts.reduce((n, g) => n + g.people.length, 0);
    const subjects = await ctx.portal.getSubjectRooms();
    assert.ok(subjects.length >= 1, "at least one subject room");
    assert.ok(subjects.every((s) => typeof s.subject === "string" && Array.isArray(s.teachers)));
    const bookings = await ctx.portal.getBookings();
    assert.ok(Array.isArray(bookings));
    const files = await ctx.portal.getFiles();
    assert.ok(Array.isArray(files));
    record(
      "B1",
      "Browser provider (contacts/subjects/bookings/files)",
      `contact groups ${contacts.length} (${people} people); subjects ${subjects.length} (${subjects.filter((s) => s.teachers.length).length} with teachers); bookings ${bookings.length}; files ${files.length}`,
    );
  },
);

test(
  "B2: activity log via the legacy read-only POST (api provider)",
  { skip: liveSkip },
  async () => {
    const ctx = e2eContext();
    await ctx.manager.ensureSession();
    const entries = await ctx.portal.getActivityLog(3);
    assert.ok(Array.isArray(entries) && entries.length <= 3);
    assert.ok(entries.every((e) => typeof e.title === "string" && typeof e.date === "string"));
    record("B2", "Activity log (legacy POST)", `${entries.length} entries`);
  },
);
