/**
 * `setup`: the guided first run as a command (src/cli/guide/first-run.ts).
 * Interactive on a terminal without answer flags; with `--query`, `--school`
 * or `--no-login`, or without a terminal, it never asks. Also decides when a
 * bare `schoolsoft-agent` starts the guide instead of printing the help.
 */
import type { Command } from "commander";
import type { CliDeps } from "../program.js";
import { currentSchool, runFirstRun } from "../guide/first-run.js";

export function registerSetup(program: Command, deps: CliDeps, emit: (d: unknown) => void): void {
  program
    .command("setup")
    .description(
      "Guided first run: find the school, log in with BankID, check that it works and show this week's schedule",
    )
    .option("--query <name>", "School name to look up without asking (takes the best match)")
    .option("--no-login", "Never start a BankID login; exit 2 when no login is saved")
    .action(async (opts: { query?: string; login: boolean }) => {
      const globals = program.opts();
      await runFirstRun(deps, globals, {
        query: opts.query,
        login: opts.login,
        // With --format text the guide on stderr is the text; stdout stays empty.
        emit: globals.format === "text" ? undefined : emit,
      });
    });
}

/**
 * A bare `schoolsoft-agent` starts the guide only for a person at a terminal
 * on a machine with nothing configured: a prompt (stdin is a TTY), stdout a
 * TTY, `CI` unset. Anything else, including a config file that cannot be
 * read, keeps the old behaviour: help and exit 6.
 */
export function startsGuide(deps: CliDeps): boolean {
  if (!deps.prompt || deps.isTTY !== true || deps.env.CI) return false;
  try {
    return currentSchool(deps, {}) === null;
  } catch {
    return false;
  }
}
