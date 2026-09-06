/**
 * `browser install` / `browser status`: the optional headless browser used
 * for capabilities SchoolSoft only offers as web pages.
 */
import type { Command } from "commander";
import { browserStatus, installChromium } from "../../core/index.js";
import { loadConfig } from "../../shared/bootstrap.js";
import type { CliDeps } from "../program.js";
import { CliExit, globalOverrides } from "../program.js";
import { EXIT } from "../exit-codes.js";

export function registerBrowser(program: Command, deps: CliDeps, emit: (d: unknown) => void): void {
  const browser = program
    .command("browser")
    .description(
      "Manage the optional headless browser (needed for contact lists, subject rooms, bookings, files)",
    );

  browser
    .command("status")
    .description("Show engine, whether playwright and Chromium are installed, and readiness")
    .action(async () => {
      const engine = engineFor(deps, program.opts());
      const status = await browserStatus(engine, deps.browserProbes);
      emit(status);
    });

  browser
    .command("install")
    .description("Download Chromium for playwright (one-time, ~150 MB)")
    .action(async () => {
      const engine = engineFor(deps, program.opts());
      if (engine.kind === "cdp") {
        emit({
          status: "not_needed",
          reason: `engine is cdp (${engine.endpoint}); nothing to install`,
        });
        return;
      }
      const code = await installChromium(deps.spawner, deps.browserProbes?.resolvePlaywright);
      if (code !== 0)
        throw new CliExit(EXIT.ERROR, `playwright install chromium exited with ${code}`);
      const status = await browserStatus(engine, deps.browserProbes);
      emit({ status: status.ready ? "installed" : "installed_but_not_ready", ...status });
    });
}

function engineFor(deps: CliDeps, opts: Record<string, unknown>) {
  try {
    return loadConfig({
      env: deps.env,
      home: deps.home,
      platform: deps.platform,
      overrides: { ...globalOverrides(opts), school: (opts.school as string) || "unconfigured" },
    }).browser;
  } catch {
    return { kind: "chromium" as const, headless: true };
  }
}
