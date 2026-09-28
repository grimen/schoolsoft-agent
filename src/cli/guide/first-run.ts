/**
 * The guided first run: from nothing to this week's schedule, in plain
 * language (docs/planning/specs/2026-09-26-guided-first-run.md). Five steps
 * (school, settings, BankID login, a check, the schedule) and a closing
 * section on where the data lives and how to add an assistant. Everything a
 * person reads goes to stderr, like the prompts; `setup` adds one JSON
 * result on stdout for scripts.
 *
 * It asks questions only when a prompt exists (stdin is a terminal) and no
 * answer flag was given; otherwise it never waits for a person, except for
 * BankID itself, which `--no-login` turns off. It is a thin client of what
 * already exists: `configure`'s lookup and write, `runOperation` for `login`
 * and `get_schedule`, `verifyOperations` from `doctor --verify`, and the
 * schedule's text view. BankID is never automated: `login` opens the
 * parent's own browser.
 */
import {
  AgentError,
  NotAuthenticatedError,
  NotConfiguredError,
  browserStatus,
  detectLang,
  getOperation,
  runOperation,
  verifyExitCode,
  verifyOperations,
  type LoginInfo,
  type OperationContext,
} from "../../core/index.js";
import { loadConfig } from "../../shared/bootstrap.js";
import type { CliDeps } from "../program.js";
import { CliExit, globalOverrides } from "../program.js";
import type { ExitCode } from "../exit-codes.js";
import { configDirOf, findSchools, providerIdOf, saveSchool } from "../commands/configure.js";
import { renderContext } from "../text/emit.js";
import { toText } from "../text/render.js";
import { textRenderer } from "../text/registry.js";
import { say, type WordKey } from "./words.js";

export interface FirstRunOptions {
  /** School name to look up without asking (`--query`). */
  query?: string;
  /** False with `--no-login`: never start BankID. */
  login: boolean;
  /** The JSON result for scripts (`setup`); absent for the bare invocation and `--format text`. */
  emit?: (data: unknown) => void;
}

type Globals = Record<string, string | undefined>;

/** How many times a question is asked before the guide gives up. */
const TRIES = 3;

/** How often the guide looks for the login address while BankID is pending. */
export const LOGIN_POLL_MS = 200;

/** The configured school, or null when nothing is configured; other config problems are thrown. */
export function currentSchool(deps: CliDeps, globals: Record<string, unknown>): string | null {
  try {
    return loadConfig({
      env: deps.env,
      home: deps.home,
      platform: deps.platform,
      overrides: globalOverrides(globals),
    }).school;
  } catch (e) {
    if (e instanceof NotConfiguredError) return null;
    throw e;
  }
}

const cancelled = () => new AgentError({ kind: "input", key: "cancelled", hint: "run_again" });

const schoolNotFound = (query: string) =>
  new AgentError({
    kind: "input",
    key: "school_not_found",
    params: { query },
    hint: "school_query",
  });

function pause(ms: number): { done: Promise<false>; stop: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const done = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  return { done, stop: () => clearTimeout(timer) };
}

export async function runFirstRun(
  deps: CliDeps,
  globals: Record<string, unknown>,
  options: FirstRunOptions,
): Promise<void> {
  const g = globals as Globals;
  const lang = detectLang(deps.env);
  const cmd = deps.env.npm_command === "exec" ? "npx -y schoolsoft-agent" : "schoolsoft-agent";
  const text = (key: WordKey, params: Record<string, string | number> = {}) =>
    say(lang, key, { cmd, ...params });
  const line = (key: WordKey, params: Record<string, string | number> = {}) =>
    deps.stderr(text(key, params));
  const item = (key: WordKey, params: Record<string, string | number> = {}) =>
    deps.stderr(`  ${text(key, params)}`);
  const step = (n: number, title: WordKey) => {
    deps.stderr("");
    line("step", { n, title: text(title) });
  };

  // An answer given as a flag means nobody is there to ask.
  const answered = options.query !== undefined || !options.login || Boolean(g.school || g.orgId);
  const prompt = answered ? undefined : deps.prompt;
  /** Ctrl+C or Ctrl+D rejects a pending question: that is a stop, not a bug. */
  const ask = async (question: WordKey, params: Record<string, string | number> = {}) => {
    try {
      return (await prompt!(text(question, params))).trim();
    } catch {
      throw cancelled();
    }
  };

  line("welcome");
  line("intro");
  line("independent");
  line("howToStop");

  // Steps 1 and 2: the school, then the settings.
  const configDir = configDirOf(deps, g);
  const providerId = providerIdOf(deps, g);
  step(1, "stepSchool");
  let chosen: { school: string; orgId?: string } | null = null;
  if (g.school) {
    chosen = { school: g.school, orgId: g.orgId };
  } else if (options.query !== undefined) {
    const [best] = await findSchools(configDir, providerId, options.query);
    if (!best) throw schoolNotFound(options.query);
    line("picked", { name: best.name });
    chosen = { school: best.slug, orgId: String(best.orgId) };
  } else {
    const configured = currentSchool(deps, globals);
    if (configured !== null) {
      line("schoolKept", { school: configured });
      line("changeSchool");
    } else if (!prompt) {
      throw new NotConfiguredError(
        "pass --query <name> or --school <slug>, or run setup in a terminal",
      );
    } else {
      chosen = await askSchool();
    }
  }
  step(2, "stepSave");
  if (chosen) {
    const { file } = saveSchool(configDir, providerId, chosen.school, chosen.orgId);
    line("saved", { school: chosen.school, file });
  } else {
    line("savedKept", { dir: configDir });
  }

  // Step 3: BankID, in the parent's own browser, unless a saved login still works.
  const ctx = await deps.getContext(globalOverrides(globals));
  step(3, "stepLogin");
  if (await loggedIn(ctx)) {
    line("loggedInAlready");
  } else {
    if (!options.login)
      throw new NotAuthenticatedError("no saved login, and setup ran with --no-login");
    if (prompt) {
      line("loginExplain");
      line("loginNever");
      await ask("askEnter");
    } else {
      line("loginOpening");
      line("loginNever");
    }
    line("loginWaiting");
    const user = await login(ctx, (url) => line("loginUrl", { url }));
    if (user.name) line("loggedIn", { name: user.name });
    else line("loggedInNoName");
  }

  // Step 4: every typed read once, fresh, nothing shown (doctor --verify's engine).
  step(4, "stepCheck");
  line("checking");
  const browser = await browserStatus(ctx.config.browser, deps.browserProbes);
  const report = await verifyOperations(ctx, { allChildren: false, browserReady: browser.ready });
  const children = ctx.manager.guardian().children.length;
  const result = {
    school: ctx.config.school,
    configDir: ctx.config.configDir,
    stateDir: ctx.config.stateDir,
    children,
    check: report.summary,
  };
  const code = verifyExitCode(report) as ExitCode;
  if (code !== 0) {
    options.emit?.({ status: "check_failed", ...result });
    const total = report.results.length;
    line("checkFailed", { failed: total - report.summary.ok, total });
    line("checkNext");
    throw new CliExit(code, "");
  }
  line("checkOk", { ok: report.summary.ok, total: report.summary.ok });
  line("children", { n: children });

  // Step 5: something real, in the text view people already know.
  step(5, "stepSchedule");
  const schedule = await runOperation(getOperation("get_schedule")!, ctx, {});
  const render = renderContext(deps);
  deps.stderr(toText(textRenderer("get_schedule")!(schedule, render), render.width, false));
  if (children > 1) {
    deps.stderr("");
    line("otherChildren");
  }

  deps.stderr("");
  line("done");
  deps.stderr("");
  line("dataHeading");
  item("dataSettings", { dir: ctx.config.configDir });
  item("dataLogin", { dir: ctx.config.stateDir });
  item("dataNotSaved");
  item("dataMore");
  deps.stderr("");
  line("hostsHeading");
  item("hostsPrivacy");
  item("hostsOtherFamilies");
  item("hostClaude", { school: ctx.config.school });
  item("hostChatgpt");
  item("hostOthers");
  deps.stderr("");
  line("commandsHeading");
  item("commandSchedule");
  item("commandLunch");
  item("commandDoctor");

  options.emit?.({ status: "ready", ...result });

  /** Ask for a name until something matches, then for a number when several do. */
  async function askSchool(): Promise<{ school: string; orgId: string }> {
    let hits: Awaited<ReturnType<typeof findSchools>> = [];
    for (let tries = 1; ; tries++) {
      const query = await ask("askSchool");
      if (query) hits = await findSchools(configDir, providerId, query);
      if (hits.length > 0) break;
      if (tries >= TRIES) throw query ? schoolNotFound(query) : cancelled();
      if (query) line("noMatch", { query });
      else line("emptySchool");
    }
    let pick = hits[0];
    if (hits.length > 1) {
      line("matches");
      hits.forEach((h, i) => deps.stderr(`  ${i + 1}. ${h.name}`));
      for (let tries = 1; ; tries++) {
        const answer = await ask("askPick", { max: hits.length });
        const n = answer === "" ? 1 : Number(answer);
        if (Number.isInteger(n) && n >= 1 && n <= hits.length) {
          pick = hits[n - 1];
          break;
        }
        if (tries >= TRIES) throw cancelled();
        line("badPick", { max: hits.length });
      }
    }
    line("picked", { name: pick.name });
    return { school: pick.slug, orgId: String(pick.orgId) };
  }
}

/** A saved login that restores counts as logged in; only "not logged in" means BankID is needed. */
async function loggedIn(ctx: OperationContext): Promise<boolean> {
  try {
    await ctx.manager.ensureSession();
    return true;
  } catch (e) {
    if (e instanceof AgentError && e.kind === "not_authenticated") return false;
    throw e;
  }
}

/**
 * The `login` operation, as `schoolsoft-agent login` runs it. While BankID is
 * pending, shows the login address once it is known, for a parent whose
 * browser did not open.
 */
async function login(ctx: OperationContext, show: (url: string) => void): Promise<LoginInfo> {
  const running = runOperation(getOperation("login")!, ctx, {}) as Promise<{ user: LoginInfo }>;
  const settled = running.then(
    () => true as const,
    () => true as const,
  );
  for (;;) {
    const pending = ctx.manager.pendingLogin();
    if (pending?.state === "running" && pending.url) {
      show(pending.url);
      break;
    }
    const wait = pause(LOGIN_POLL_MS);
    const done = await Promise.race([settled, wait.done]);
    wait.stop();
    if (done) break;
  }
  return (await running).user;
}
