/**
 * `doctor --verify`: the thin CLI caller of core's verifyOperations. Measures
 * whether the optional browser is usable (local, no request), runs the check
 * with the saved session, prints the report as JSON and exits by
 * verifyExitCode. Never logs in; without a session the usual
 * not-authenticated error comes before any request.
 */
import { browserStatus, verifyExitCode, verifyOperations } from "../../core/index.js";
import type { CliDeps } from "../program.js";
import { CliExit, globalOverrides } from "../program.js";
import type { ExitCode } from "../exit-codes.js";

export async function runVerify(
  deps: CliDeps,
  globals: Record<string, unknown>,
  allChildren: boolean,
  emit: (data: unknown) => void,
): Promise<void> {
  const ctx = await deps.getContext(globalOverrides(globals));
  const browser = await browserStatus(ctx.config.browser, deps.browserProbes);
  const report = await verifyOperations(ctx, { allChildren, browserReady: browser.ready });
  emit(report);
  const code = verifyExitCode(report);
  if (code !== 0) throw new CliExit(code as ExitCode, "");
}
