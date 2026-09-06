/**
 * 03 — Discovery: answers the remaining open questions in CLAUDE.md and
 * probes what the guardian API actually exposes, feeding the roadmap
 * (messages, write-ops, multi-child). Findings land in e2e-report.md.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { e2eContext } from "./helpers.js";
import { skip, record } from "./helpers.js";

test("D1: guardian context + webview session shape", { skip }, async () => {
  const ctx = e2eContext();
  const manager = ctx.manager;
  await manager.ensureSession();
  const guardian = manager.guardian();
  const session = await ctx.portal.getSession();
  record(
    "Q3",
    "Multi-child session shape",
    `${guardian.children.length} children (${guardian.children.map((c) => c.schools[0]?.className).join(", ")}), ` +
      `focus=${guardian.childInFocus}; /rest-api/session keys: ${Object.keys(session as object).join(",")}`,
  );
  const { writeFileSync } = await import("node:fs");
  writeFileSync("e2e-session-dump.json", JSON.stringify({ guardian, session }, null, 2));
  console.log("session dump → e2e-session-dump.json (gitignored)");
  assert.ok(session);
});

test("D2: guardian API coverage (Eva + webview)", { skip }, async () => {
  const ctx = e2eContext();
  const manager = ctx.manager;
  await manager.ensureSession();
  const api = ctx.portal;
  const guardian = manager.guardian();
  const child = guardian.children.find((c) => c.studentId === guardian.childInFocus)!;
  const orgId = child.schools[0].orgId;
  const week = 37;
  const probes: [string, () => Promise<unknown>][] = [
    ["lunch", () => api.getLunchWeek(orgId, week)],
    ["news", () => api.getNews(guardian.userId, orgId, child.studentId)],
    ["inbox", () => api.getInbox(guardian.userId, orgId)],
    ["nextEvent", () => api.getNextCalendarEvent(guardian.userId, orgId, child.studentId)],
    ["schedule", () => api.getScheduleWeek(week)],
    ["assignments", () => api.getAssignmentsWeek(week, new Date().getFullYear())],
  ];
  const results: string[] = [];
  for (const [name, fn] of probes) {
    try {
      const r = await fn();
      results.push(`${name}: OK${Array.isArray(r) ? `(${r.length})` : ""}`);
    } catch (e) {
      results.push(`${name}: FAIL (${e instanceof Error ? e.message : e})`);
    }
  }
  record("D2", "Guardian API coverage", results.join("; "));
  assert.ok(
    results.every((r) => !r.includes("FAIL")),
    results.join("; "),
  );
});

test("D3: token lifetime snapshot for longitudinal tracking", { skip }, async () => {
  // Rerun this suite over several days; the report accumulates a
  // timeline showing when refresh happens vs when re-login is forced.
  const { loadPersisted, creds } = await import("./helpers.js");
  const saved = loadPersisted();
  record(
    "Q4d",
    `Lifetime snapshot @ ${new Date().toISOString()}`,
    saved
      ? `authMethod=${saved.authMethod}, savedAt=${new Date(saved.savedAt).toISOString()}, ` +
          `expiresAt=${creds(saved).accessTokenExpiresAt ? new Date(creds(saved).accessTokenExpiresAt! * 1000).toISOString() : "?"}`
      : "no session",
  );
  assert.ok(true);
});
