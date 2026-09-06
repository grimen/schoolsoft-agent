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
import {
  FileSessionStore,
  type PersistedSession,
  type OperationContext,
} from "../../src/core/index.js";
import { loadConfig, loadContext } from "../../src/shared/bootstrap.js";

export const LIVE = process.env.SCHOOLSOFT_E2E === "1";
export const skip = LIVE ? false : "set SCHOOLSOFT_E2E=1 (and SCHOOLSOFT_SCHOOL) to run live e2e";

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

const inputs = () => ({ env: process.env, home: homedir(), platform: process.platform });

let ctxFactory: (() => OperationContext) | null = null;

/** The same context production adapters build — one per test process. */
export function e2eContext(): OperationContext {
  if (!ctxFactory) ctxFactory = loadContext(inputs());
  return ctxFactory();
}

export function e2eStore(): FileSessionStore {
  return new FileSessionStore(loadConfig(inputs()).stateDir);
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
  return loadConfig(inputs()).stateDir;
}
