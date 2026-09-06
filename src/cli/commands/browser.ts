/**
 * `browser install` / `browser status`: the optional headless browser used
 * for capabilities SchoolSoft only offers as web pages.
 */
import type { Command } from "commander";
import type { BrowserSession, OperationContext } from "../../core/index.js";
import {
  browserStatus,
  createApiPortal,
  createBrowserSession,
  installChromium,
  verifyPages,
} from "../../core/index.js";
import { loadConfig } from "../../shared/bootstrap.js";
import type { CliDeps } from "../program.js";
import { CliExit, globalOverrides } from "../program.js";
import { EXIT } from "../exit-codes.js";

export function registerBrowser(program: Command, deps: CliDeps, emit: (d: unknown) => void): void {
  const browser = program
    .command("browser")
    .description(
      "Manage the optional headless browser (contact lists, bookings, files and the GDPR-gated pages)",
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

  browser
    .command("verify")
    .description(
      "Load every page the browser reads and check its anchors and structural fingerprint (after a SchoolSoft update)",
    )
    .action(async () => {
      const ctx = await deps.getContext(globalOverrides(program.opts()));
      await ctx.manager.ensureSession();
      const session = (deps.browserSession ?? defaultBrowserSession)(ctx);
      try {
        const pages = await verifyPages(session, {
          hasWebSession: ctx.manager.getWebSession() !== null,
          syncWebChild: () => createApiPortal(ctx.manager).syncWebChild(),
        });
        const bad = pages.filter((p) => p.status === "broken" || p.status === "error");
        emit({
          status: bad.length ? "broken" : pages.some((p) => p.status === "drift") ? "drift" : "ok",
          pages,
        });
        if (bad.length)
          throw new CliExit(
            EXIT.ERROR,
            `${bad.length} page(s) no longer match: ${bad.map((p) => p.page).join(", ")}`,
          );
      } finally {
        await session.close();
      }
    });
}

/** Production browser session for `browser verify`: the manager's cookies, the configured engine. */
export function defaultBrowserSession(ctx: OperationContext): BrowserSession {
  return createBrowserSession(ctx.manager, { engine: ctx.config.browser });
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
