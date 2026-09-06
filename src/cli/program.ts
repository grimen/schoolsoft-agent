/**
 * CLI surface: one subcommand per operation (kebab-case) plus `configure`
 * and `doctor`. JSON on stdout, one-line errors on stderr, exit codes from
 * exit-codes.ts. Everything external is injected through CliDeps so the
 * whole program is testable in-process.
 */
import { Command, CommanderError } from "commander";
import {
  operations,
  NotAuthenticatedError,
  NotConfiguredError,
  type ConfigSource,
  type OperationContext,
} from "../core/index.js";
import { flagsFromSchema, parseFlags, kebab } from "./flags.js";
import { EXIT, type ExitCode } from "./exit-codes.js";
import { registerConfigure } from "./commands/configure.js";
import { registerDoctor } from "./commands/doctor.js";

export interface CliDeps {
  /** Builds the operation context; `overrides` come from global flags. */
  getContext: (overrides: ConfigSource) => Promise<OperationContext> | OperationContext;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  env: Record<string, string | undefined>;
  home: string;
  platform: NodeJS.Platform;
  version: string;
  /** Interactive prompt for `configure`; absent → non-interactive only. */
  prompt?: (question: string) => Promise<string>;
  /** Used by `doctor` to test reachability; injectable for tests. */
  fetchImpl?: (url: string, init?: { method?: string }) => Promise<{ status: number }>;
}

export class CliExit extends Error {
  constructor(
    public readonly code: ExitCode,
    message: string,
  ) {
    super(message);
    this.name = "CliExit";
  }
}

export function globalOverrides(opts: Record<string, unknown>): ConfigSource {
  return {
    school: opts.school as string | undefined,
    orgId: opts.orgId as string | undefined,
    configDir: opts.configDir as string | undefined,
    stateDir: opts.stateDir as string | undefined,
  };
}

export function buildProgram(deps: CliDeps): Command {
  const program = new Command("schoolsoft-agent")
    .description("SchoolSoft for AI agents — guardian access via BankID. Output is JSON.")
    .version(deps.version)
    .option("--school <slug>", "School slug (overrides config/env), e.g. taby")
    .option("--org-id <id>", "School orgId (rarely needed)")
    .option("--config-dir <dir>", "Config directory")
    .option("--state-dir <dir>", "Session state directory")
    .option("--pretty", "Pretty-print JSON output")
    .exitOverride()
    .configureOutput({
      writeOut: (s) => deps.stdout(s.trimEnd()),
      writeErr: (s) => deps.stderr(s.trimEnd()),
    });

  const emit = (data: unknown) => {
    const pretty = Boolean(program.opts().pretty);
    deps.stdout(JSON.stringify(data, null, pretty ? 2 : 0));
  };

  for (const op of operations) {
    const specs = flagsFromSchema(op.input);
    const cmd = program.command(kebab(op.name)).description(firstLine(op.description));
    for (const s of specs) {
      if (s.required) cmd.requiredOption(s.flag, s.description);
      else cmd.option(s.flag, s.description);
    }
    cmd.action(async (opts: Record<string, unknown>) => {
      const args = parseFlags(specs, opts);
      const ctx = await deps.getContext(globalOverrides(program.opts()));
      const result = await op.run(ctx, args as never);
      emit(result);
    });
  }

  registerConfigure(program, deps, emit);
  registerDoctor(program, deps, emit);
  return program;
}

function firstLine(s: string): string {
  return s.split("\n")[0].trim();
}

/** Run the CLI; never throws, returns the exit code. */
export async function runCli(argv: string[], deps: CliDeps): Promise<ExitCode> {
  const program = buildProgram(deps);
  try {
    await program.parseAsync(argv, { from: "user" });
    return EXIT.OK;
  } catch (e) {
    return toExitCode(e, deps.stderr);
  }
}

export function toExitCode(e: unknown, stderr: (s: string) => void): ExitCode {
  if (e instanceof CommanderError) {
    // help/version print and exit 0; usage errors exit 1
    if (e.exitCode === 0) return EXIT.OK;
    return EXIT.ERROR;
  }
  if (e instanceof CliExit) {
    if (e.message) stderr(e.message);
    return e.code;
  }
  if (e instanceof NotAuthenticatedError) {
    stderr(
      `Not authenticated: run "schoolsoft-agent login" (opens your browser for BankID). ${e.message}`,
    );
    return EXIT.NOT_AUTHENTICATED;
  }
  if (e instanceof NotConfiguredError) {
    stderr(e.message);
    return EXIT.NOT_CONFIGURED;
  }
  stderr(`Error: ${e instanceof Error ? e.message : String(e)}`);
  return EXIT.ERROR;
}
