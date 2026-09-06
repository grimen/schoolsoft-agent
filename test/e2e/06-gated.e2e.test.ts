/**
 * 06 — GDPR-gated capabilities through the WEB login session against real
 * SchoolSoft. Requires `login --web` once (skips with a reason otherwise)
 * and the headless browser. Read-only; counts and shapes only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { browserStatus } from "../../src/core/index.js";
import { skip as liveSkip, record, e2eContext } from "./helpers.js";

const status = await browserStatus({ kind: "chromium" });
const ctx0 = liveSkip ? null : e2eContext();
const hasWeb =
  ctx0?.manager.getWebSession() !== null && ctx0?.manager.getWebSession() !== undefined;
const skip =
  liveSkip ||
  (!hasWeb
    ? "no web session (run: make login-web)"
    : status.ready
      ? false
      : `headless browser not installed (${status.hint})`);

test(
  "G1: grades, documents, unreported absence, attendance report via the web session",
  { skip },
  async () => {
    const ctx = e2eContext();
    await ctx.manager.ensureSession();
    const grades = await ctx.portal.getGrades();
    assert.equal(grades.title, "Betyg");
    const docs = await ctx.portal.getStudentDocuments();
    assert.equal(docs.title, "Elevdokument");
    const absence = await ctx.portal.getUnreportedAbsence();
    assert.ok(absence.message || absence.sections.length);
    const report = await ctx.portal.getAttendanceReport();
    assert.ok(report.title.length > 0);
    record(
      "G1",
      "Gated pages via web session",
      `grades sections ${grades.sections.length}; documents rows ${docs.sections.reduce((n, s) => n + s.rows.length, 0)}; absence ${absence.message ? "message" : absence.sections.length + " sections"}; report sections ${report.sections.length}`,
    );
  },
);

test(
  "G2: assessment criteria for the first subject, and grade prognosis dates (gated REST)",
  { skip },
  async () => {
    const ctx = e2eContext();
    await ctx.manager.ensureSession();
    const rooms = await ctx.portal.getSubjectRooms();
    const first = rooms.find((r) => r.subjectId !== null);
    assert.ok(first, "a subject with an id");
    const crit = await ctx.portal.getAssessmentCriteria(first!.subjectId!);
    assert.ok(crit.title.length > 0);
    const prog = await ctx.portal.getGradePrognosis();
    assert.ok("reconciliationDates" in prog);
    record(
      "G2",
      "Criteria + prognosis",
      `criteria sections ${crit.sections.length} (rows ${crit.sections.reduce((n, s) => n + s.rows.length, 0)}); prognosis dates ${Array.isArray(prog.reconciliationDates) ? prog.reconciliationDates.length : typeof prog.reconciliationDates}`,
    );
  },
);
