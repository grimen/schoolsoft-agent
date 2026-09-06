/**
 * CLI surface: one subcommand per operation (kebab-case) plus `configure`
 * and `doctor`. JSON on stdout, one-line errors on stderr, exit codes from
 * exit-codes.ts. Everything external is injected through CliDeps so the
 * whole program is testable in-process.
 */
import { Command, CommanderError } from "commander";
import {
  operations,
  describeError,
  detectLang,
  type ConfigSource,
  type Lang,
  type OperationContext,
} from "../core/index.js";
import { flagsFromSchema, parseFlags, kebab } from "./flags.js";
import { EXIT, type ExitCode } from "./exit-codes.js";
import { registerConfigure } from "./commands/configure.js";
import { registerDoctor } from "./commands/doctor.js";
import { registerBrowser } from "./commands/browser.js";

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
  /** Injectable probes / spawner for the browser commands and doctor. */
  browserProbes?: import("../core/index.js").StatusProbes;
  spawner?: import("../core/index.js").Spawner;
  /** Browser session for `browser verify`; defaults to the production one, injectable for tests. */
  browserSession?: (ctx: OperationContext) => import("../core/index.js").BrowserSession;
  /**
   * Starts a detached copy of this CLI with the given arguments and returns its pid;
   * used by `login --background` so the callback server outlives this process.
   */
  detach?: (argv: string[]) => number;
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
      if (op.name === "login" && (args as { background?: boolean }).background && deps.detach) {
        // A CLI process cannot both return now and keep the callback server alive:
        // hand the blocking login to a detached copy and report its URL.
        emit(await backgroundLogin(ctx, deps, program.opts(), args as Record<string, unknown>));
        return;
      }
      const result = await op.run(ctx, args as never);
      emit(result);
    });
  }

  registerConfigure(program, deps, emit);
  registerDoctor(program, deps, emit);
  registerBrowser(program, deps, emit);
  return program;
}

/** Spawn `login` detached, then wait briefly for the URL it records in the pending-login marker. */
async function backgroundLogin(
  ctx: OperationContext,
  deps: CliDeps,
  globals: Record<string, unknown>,
  args: Record<string, unknown>,
  urlTimeoutMs = 5000,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<Record<string, unknown>> {
  const already = ctx.manager.pendingLogin();
  if (already?.state === "running") {
    return {
      status: "login_started",
      url: already.url,
      startedAt: new Date(already.startedAt).toISOString(),
      pid: already.pid,
      next: "Complete BankID in the open browser window, then run auth-status.",
    };
  }
  const argv: string[] = [];
  for (const [k, v] of Object.entries(globalOverrides(globals)))
    if (v) argv.push(`--${kebab(k)}`, String(v));
  argv.push("login");
  if (args.strategy) argv.push("--strategy", String(args.strategy));
  const pid = deps.detach!(argv);
  const deadline = Date.now() + urlTimeoutMs;
  let url: string | undefined;
  while (Date.now() < deadline) {
    const p = ctx.manager.pendingLogin();
    if (p?.url) {
      url = p.url;
      break;
    }
    await sleep(100);
  }
  return {
    status: "login_started",
    url,
    pid,
    next: "Ask the user to complete BankID in the browser window, then run auth-status until authenticated is true.",
  };
}

export { backgroundLogin };

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
    return toExitCode(e, deps.stderr, detectLang(deps.env));
  }
}

/**
 * One line for the problem, one line for what to do next, an exit code a
 * skill can branch on. Rendered in the user's language (SCHOOLSOFT_LANG,
 * else the locale).
 */
export function toExitCode(e: unknown, stderr: (s: string) => void, lang: Lang = "en"): ExitCode {
  if (e instanceof CommanderError) {
    // help/version print and exit 0; usage errors are input errors
    if (e.exitCode === 0) return EXIT.OK;
    return EXIT.INPUT;
  }
  if (e instanceof CliExit) {
    if (e.message) stderr(e.message);
    return e.code;
  }
  const d = describeError(e, lang, "cli");
  stderr(d.message);
  if (d.hint) stderr(`${lang === "sv" ? "Nästa steg" : "Next"}: ${d.hint}`);
  return d.exitCode as ExitCode;
}
