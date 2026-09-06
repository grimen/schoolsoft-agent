/**
 * `doctor`: environment, config, session and connectivity checks, with
 * `--fix` to migrate a legacy ~/.schoolsoft-mcp session store.
 */
import type { Command } from "commander";
import { existsSync, mkdirSync, renameSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  FileSessionStore,
  NotConfiguredError,
  browserStatus,
  type Config,
} from "../../core/index.js";
import { loadConfig } from "../../shared/bootstrap.js";
import type { CliDeps } from "../program.js";
import { CliExit, globalOverrides } from "../program.js";
import { EXIT } from "../exit-codes.js";

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export const LEGACY_STATE_DIR = ".schoolsoft-mcp";

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
    checks.push({
      name: "config",
      ok: true,
      detail: `school=${config.school} configDir=${config.configDir}`,
    });
  } catch (e) {
    checks.push({
      name: "config",
      ok: false,
      detail:
        e instanceof NotConfiguredError
          ? "not configured — run: schoolsoft-agent configure"
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
    const saved = new FileSessionStore(config.stateDir).load();
    checks.push({
      name: "session",
      ok: Boolean(saved),
      detail: saved
        ? `saved ${new Date(saved.savedAt).toISOString()} via ${saved.authMethod}, children=${saved.guardian?.children.length ?? "?"}`
        : `no session in ${config.stateDir} — run: schoolsoft-agent login`,
    });
  }

  // Default goes through globalThis.fetch so tests can stub it without network.
  const fetchImpl =
    deps.fetchImpl ?? ((url: string, init?: { method?: string }) => globalThis.fetch(url, init));
  try {
    const r = await fetchImpl("https://sms.schoolsoft.se/", { method: "HEAD" });
    checks.push({
      name: "network",
      ok: r.status < 500,
      detail: `sms.schoolsoft.se HTTP ${r.status}`,
    });
  } catch (e) {
    checks.push({
      name: "network",
      ok: false,
      detail: `sms.schoolsoft.se unreachable: ${e instanceof Error ? e.message : e}`,
    });
  }
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
    .action(async (opts: { fix?: boolean }) => {
      const result = await runDoctor(deps, program.opts(), Boolean(opts.fix), process.version);
      emit(result);
      if (!result.ok) throw new CliExit(EXIT.ERROR, "");
    });
}
