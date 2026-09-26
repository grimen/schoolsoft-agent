/**
 * `doctor`: environment, config, session and connectivity checks, with
 * `--fix` to migrate a legacy ~/.schoolsoft-mcp session store, and
 * `--verify` for the live parse check of the typed operations (verify.ts).
 */
import type { Command } from "commander";
import { existsSync, mkdirSync, renameSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  AgentError,
  InputError,
  CONFIG_FORMAT,
  FileSessionHistoryStore,
  FileSessionStore,
  HISTORY_FORMAT,
  NotConfiguredError,
  SESSION_FORMAT,
  accountKeyOf,
  describeVersion,
  emptyHistory,
  summarizeHistory,
  browserStatus,
  createRequestBudget,
  portalHealth,
  probePortal,
  type Config,
  type SessionHistory,
  type PersistedSession,
} from "../../core/index.js";
import { configFileVersion, loadConfig } from "../../shared/bootstrap.js";
import type { CliDeps } from "../program.js";
import { CliExit, globalOverrides } from "../program.js";
import { EXIT } from "../exit-codes.js";
import { runVerify } from "./verify.js";

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export const LEGACY_STATE_DIR = ".schoolsoft-mcp";

/**
 * The current account's saved session and the file's format version; a
 * session from a newer build fails the check. Other stored accounts are counted.
 */
function sessionCheck(config: Config): DoctorCheck {
  const account = accountKeyOf(config);
  const store = new FileSessionStore(config.stateDir, account);
  let saved: PersistedSession | null;
  try {
    saved = store.load();
  } catch (e) {
    return { name: "session", ok: false, detail: (e as Error).message };
  }
  if (!saved) {
    return {
      name: "session",
      ok: false,
      detail: `no session for ${account} in ${config.stateDir} — run: schoolsoft-agent login`,
    };
  }
  const stored = store.accounts().length;
  return {
    name: "session",
    ok: true,
    detail:
      `saved ${new Date(saved.savedAt).toISOString()} via ${saved.authMethod}, children=${saved.guardian?.children.length ?? "?"}, ` +
      `account=${account}${stored > 1 ? `, ${stored} accounts stored` : ""}; ` +
      describeVersion(SESSION_FORMAT, store.storedVersion()),
  };
}

/** Observed lifetimes (informational, never a failure) unless the file is from a newer build. */
function historyCheck(config: Config, now: number): DoctorCheck {
  const store = new FileSessionHistoryStore(config.stateDir, accountKeyOf(config));
  let stored: SessionHistory | null;
  try {
    stored = store.read();
  } catch (e) {
    return { name: "session-history", ok: false, detail: (e as Error).message };
  }
  const history = summarizeHistory(stored ?? emptyHistory(), now);
  const version = store.storedVersion();
  const last = history.losses.at(-1);
  return {
    name: "session-history",
    ok: true,
    detail:
      `keepalive=${config.keepalive.mode}; ` +
      (version === null ? "" : `${describeVersion(HISTORY_FORMAT, version)}; `) +
      (history.app
        ? `app login ${history.app.ageMinutes ?? "?"} min old, ${history.app.activityCount} refreshes, longest gap survived ${history.app.longestGapSurvivedMinutes} min; `
        : "") +
      (history.web
        ? `web login ${history.web.ageMinutes} min old, idle ${history.web.idleMinutes} min, longest gap survived ${history.web.longestGapSurvivedMinutes} min; `
        : "") +
      (last
        ? `${history.losses.length} observed losses, last: ${last.session} session at ${last.at} after ${last.ageMinutes ?? "?"} min (idle ${last.idleMinutes} min)`
        : "no session loss observed yet") +
      " (full record: schoolsoft-agent auth-status)",
  };
}

export async function runDoctor(
  deps: CliDeps,
  overrides: Record<string, unknown>,
  fix: boolean,
  nodeVersion: string,
): Promise<{ ok: boolean; checks: DoctorCheck[] }> {
  const checks: DoctorCheck[] = [];
  const major = Number(nodeVersion.replace(/^v/, "").split(".")[0]);
  checks.push({ name: "node", ok: major >= 22, detail: `node ${nodeVersion} (need >= 22)` });

  let config: Config | null = null;
  try {
    config = loadConfig({
      env: deps.env,
      home: deps.home,
      platform: deps.platform,
      overrides: globalOverrides(overrides),
    });
    const version = configFileVersion(config.configDir);
    checks.push({
      name: "config",
      ok: true,
      detail:
        `school=${config.school} configDir=${config.configDir}; config.json ` +
        (version === null ? "absent" : describeVersion(CONFIG_FORMAT, version)),
    });
  } catch (e) {
    checks.push({
      name: "config",
      ok: false,
      detail:
        e instanceof NotConfiguredError
          ? "not configured — run: schoolsoft-agent configure"
          : e instanceof AgentError
            ? e.message
            : String(e),
    });
  }

  if (config) {
    const legacy = join(deps.home, LEGACY_STATE_DIR);
    const hasLegacy = existsSync(join(legacy, "session.enc"));
    const hasCurrent = existsSync(join(config.stateDir, "session.enc"));
    if (hasLegacy && !hasCurrent && fix) {
      mkdirSync(config.stateDir, { recursive: true, mode: 0o700 });
      for (const f of readdirSync(legacy)) renameSync(join(legacy, f), join(config.stateDir, f));
      checks.push({ name: "migration", ok: true, detail: `moved ${legacy} → ${config.stateDir}` });
    } else if (hasLegacy && !hasCurrent) {
      checks.push({
        name: "migration",
        ok: false,
        detail: `legacy session in ${legacy}; run doctor --fix to move it`,
      });
    }
    checks.push(sessionCheck(config));
    checks.push(historyCheck(config, deps.now?.() ?? Date.now()));
  }

  // Through a request budget like every request to the portal (the provider's HTTP; tests inject fetchImpl).
  const budgetConfig = config ?? { provider: "schoolsoft", requestBudget: {} };
  const budget = createRequestBudget(budgetConfig);
  try {
    const status = await probePortal(budgetConfig, { budget, fetchImpl: deps.fetchImpl });
    checks.push({
      name: "network",
      ok: status < 500,
      detail: `school portal HTTP ${status}`,
    });
  } catch (e) {
    checks.push({
      name: "network",
      ok: false,
      detail: `school portal unreachable: ${e instanceof Error ? e.message : e}`,
    });
  }
  const { limits } = budget.snapshot();
  const health = portalHealth(budget.snapshot());
  checks.push({
    name: "request-budget",
    ok: true, // informational: this process starts fresh; a running server reports its own in auth-status
    detail:
      `${limits.perMinute}/min, burst ${limits.burst}, ${limits.maxInFlight} in flight (per process); ` +
      `portal ${health.state}${health.retryAt ? ` until ${health.retryAt}` : ""}` +
      "; a running MCP server or connector reports its own state in auth-status / the owner dashboard",
  });
  const bs = await browserStatus(
    config?.browser ?? { kind: "chromium", headless: true },
    deps.browserProbes,
  );
  checks.push({
    name: "headless-browser",
    ok: true, // optional: never fails doctor
    detail: bs.ready
      ? `ready (${bs.engine}${bs.executablePath ? ", " + bs.executablePath : ""})`
      : `not installed — only contact lists, bookings, files and the gated pages need it (${bs.hint})`,
  });

  const opener =
    deps.platform === "darwin" ? "open" : deps.platform === "win32" ? "cmd" : "xdg-open";
  checks.push({
    name: "browser",
    ok: true,
    detail: `login opens the browser with "${opener}"; sandboxed hosts must show the printed URL instead`,
  });

  return { ok: checks.every((c) => c.ok), checks };
}

export function registerDoctor(program: Command, deps: CliDeps, emit: (d: unknown) => void): void {
  program
    .command("doctor")
    .description("Diagnose environment, config, session and connectivity")
    .option("--fix", "Apply safe fixes (migrate a legacy ~/.schoolsoft-mcp session)")
    .option(
      "--verify",
      "Check that each typed read still parses against the live portal (saved session only; prints no data)",
    )
    .option("--all-children", "With --verify: check every child, not only the one in focus")
    .action(async (opts: { fix?: boolean; verify?: boolean; allChildren?: boolean }) => {
      if (opts.allChildren && !opts.verify) throw new InputError("--all-children needs --verify");
      if (opts.verify) return runVerify(deps, program.opts(), Boolean(opts.allChildren), emit);
      const result = await runDoctor(deps, program.opts(), Boolean(opts.fix), process.version);
      emit(result);
      if (!result.ok) throw new CliExit(EXIT.ERROR, "");
    });
}
