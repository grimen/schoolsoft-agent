/**
 * Shared E2E infrastructure.
 *
 * - Gating: every e2e test passes `{ skip }` from here.
 * - Findings: `record()` appends answers to the live-verification
 *   questions into e2e-report.md (gitignored — may reference real data).
 * - Session manipulation: helpers to corrupt/expire the persisted
 *   session so refresh/failure paths can be exercised against the real
 *   backend without waiting days for natural expiry.
 */
import { appendFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { FileSessionStore } from "../../src/services/file-store.js";
import { DEFAULT_STATE_DIR_ENV } from "../../src/constants.js";
import type { PersistedSession } from "../../src/services/store.js";

export const LIVE = process.env.SCHOOLSOFT_E2E === "1";
export const skip = LIVE
  ? false
  : "set SCHOOLSOFT_E2E=1 (and SCHOOLSOFT_SCHOOL) to run live e2e";

export const REPORT_PATH = join(process.cwd(), "e2e-report.md");

export function initReport(): void {
  if (!LIVE) return;
  writeFileSync(
    REPORT_PATH,
    `# E2E findings — ${new Date().toISOString()}\n\n` +
      `School: ${process.env.SCHOOLSOFT_SCHOOL}\n\n` +
      `| # | Question | Finding |\n|---|---|---|\n`,
  );
}

/** Append a finding row answering one of CLAUDE.md's open questions. */
export function record(id: string, question: string, finding: string): void {
  if (!LIVE) return;
  if (!existsSync(REPORT_PATH)) initReport();
  const clean = finding.replace(/\n/g, " ").slice(0, 400);
  appendFileSync(REPORT_PATH, `| ${id} | ${question} | ${clean} |\n`);
  console.log(`[finding ${id}] ${question} → ${clean}`);
}

export function e2eStore(): FileSessionStore {
  return FileSessionStore.fromEnv(DEFAULT_STATE_DIR_ENV);
}

export function loadPersisted(): PersistedSession | null {
  return e2eStore().load();
}

/** Force the access token to look expired, keeping the refresh token. */
export function forceExpireAccessToken(): boolean {
  const store = e2eStore();
  const saved = store.load();
  if (!saved?.refreshToken) return false;
  // Unix seconds, like ssp-node.
  store.save({ ...saved, accessTokenExpiresAt: Math.floor(Date.now() / 1000) - 60 });
  return true;
}

export function stateDirInfo(): string {
  return process.env[DEFAULT_STATE_DIR_ENV] ?? join(homedir(), ".schoolsoft-mcp");
}
