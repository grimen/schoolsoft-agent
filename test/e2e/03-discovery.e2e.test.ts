/**
 * 03 — Discovery: answers the remaining open questions in CLAUDE.md and
 * probes what the guardian API actually exposes, feeding the roadmap
 * (messages, write-ops, multi-child). Findings land in e2e-report.md.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { sessionManager } from "../../src/services/wiring.js";
import { skip, record } from "./helpers.js";

test("D1: session shape — multi-child / org inspection", { skip }, async () => {
  const client = await sessionManager().ensureSession();
  const session = await client.getSession();
  const json = JSON.stringify(session);
  // Heuristics: look for arrays that could be children/orgs/students.
  const childish = ["students", "children", "orgs", "pupils"].filter((k) =>
    json.toLowerCase().includes(`"${k}"`),
  );
  record(
    "Q3",
    "Multi-child session shape",
    childish.length
      ? `candidate keys: ${childish.join(", ")} — inspect e2e-session-dump.json`
      : "no obvious child/org arrays — switching may be a separate endpoint",
  );
  const { writeFileSync } = await import("node:fs");
  writeFileSync("e2e-session-dump.json", JSON.stringify(session, null, 2));
  console.log("session dump → e2e-session-dump.json (gitignored)");
  assert.ok(session);
});

test("D2: startpage + class list availability (guardian account)", { skip }, async () => {
  const client = await sessionManager().ensureSession();
  const results: string[] = [];
  try {
    await client.getStartpage();
    results.push("getStartpage: OK");
  } catch (e) {
    results.push(`getStartpage: FAIL (${e instanceof Error ? e.message : e})`);
  }
  try {
    const students = await client.getClassStudents();
    results.push(`getClassStudents: OK (${students.length})`);
  } catch (e) {
    results.push(`getClassStudents: FAIL (${e instanceof Error ? e.message : e})`);
  }
  record("D2", "ssp-node guardian coverage", results.join("; "));
});

test("D3: token lifetime snapshot for longitudinal tracking", { skip }, async () => {
  // Rerun this suite over several days; the report accumulates a
  // timeline showing when refresh happens vs when re-login is forced.
  const { loadPersisted } = await import("./helpers.js");
  const saved = loadPersisted();
  record(
    "Q4d",
    `Lifetime snapshot @ ${new Date().toISOString()}`,
    saved
      ? `authMethod=${saved.authMethod}, savedAt=${new Date(saved.savedAt).toISOString()}, ` +
          `expiresAt=${saved.accessTokenExpiresAt ? new Date(saved.accessTokenExpiresAt).toISOString() : "?"}`
      : "no session",
  );
  assert.ok(true);
});
