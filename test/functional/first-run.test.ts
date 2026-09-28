/**
 * Functional: the guided first run (`schoolsoft-agent` bare, and `setup`)
 * through the commander program in-process, over the fake session manager
 * and fake portal. Prompts are scripted; the school list is a cached
 * synthetic `schools.json`, so nothing touches the network and no real
 * login happens. Covers both entry points, interactive and non-interactive
 * runs, resuming, every stop (not configured, not logged in, no match,
 * cancelled, a failed check), both languages and the npx command prefix.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli, type CliDeps } from "../../src/cli/program.js";
import { EXIT } from "../../src/cli/exit-codes.js";
import {
  MemoryPendingLoginStore,
  MemorySessionStore,
  NetworkError,
  type PendingLogin,
  type Portal,
} from "../../src/core/index.js";
import { ResponseDriftError } from "../../src/core/errors/index.js";
import { CONTEXT, fakePortal, makeContext } from "../helpers/fakes.js";

const SCHOOLS = [
  { name: "Påhittade kommun - Testskolan", slug: "testskola", orgId: 20 },
  { name: "Påhittade kommun - Testskolan Norra", slug: "testskola", orgId: 21 },
  { name: "Annan kommun - Ängsskolan", slug: "annan", orgId: 30 },
];

interface Options {
  /** Scripted answers; a function answer can throw (Ctrl+C). */
  answers?: (string | (() => never))[];
  /** No prompt at all (stdin is not a terminal). */
  noPrompt?: boolean;
  isTTY?: boolean;
  env?: Record<string, string>;
  store?: MemorySessionStore;
  portal?: Portal;
  pending?: MemoryPendingLoginStore;
}

function harness(o: Options = {}) {
  const configDir = mkdtempSync(join(tmpdir(), "first-run-"));
  writeFileSync(
    join(configDir, "schools.json"),
    JSON.stringify({ fetchedAt: Date.now(), schools: SCHOOLS }),
  );
  const stateDir = join(configDir, "state");
  const h = makeContext({
    config: { configDir, stateDir },
    store: o.store,
    portal: o.portal,
    pending: o.pending,
  });
  const out: string[] = [];
  const err: string[] = [];
  const asked: string[] = [];
  const answers = [...(o.answers ?? [])];
  const deps: CliDeps = {
    getContext: () => h.ctx,
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    env: { SCHOOLSOFT_CONFIG_DIR: configDir, ...o.env },
    home: mkdtempSync(join(tmpdir(), "home-")),
    platform: "linux",
    version: "9.9.9",
    isTTY: o.isTTY ?? true,
    now: () => Date.parse("2026-09-01T10:00:00+02:00"),
    browserProbes: {
      resolvePlaywright: () => {
        throw new Error("not installed");
      },
    },
    prompt: o.noPrompt
      ? undefined
      : async (q) => {
          asked.push(q);
          const next = answers.shift();
          if (next === undefined) throw new Error(`unexpected question: ${q}`);
          return typeof next === "function" ? next() : next;
        },
  };
  const run = async (...argv: string[]) => {
    out.length = 0;
    err.length = 0;
    asked.length = 0;
    const code = await runCli(argv, deps);
    return { code, out: out.join("\n"), err: err.join("\n") };
  };
  const config = () =>
    JSON.parse(readFileSync(join(configDir, "config.json"), "utf8")) as {
      account: string;
      accounts: Record<string, { school: string; orgId?: string }>;
    };
  return { run, h, deps, asked, configDir, stateDir, config };
}

/** The Ctrl+C rejection readline/promises gives a pending question. */
const ctrlC = (): never => {
  throw Object.assign(new Error("Aborted with Ctrl+C"), { name: "AbortError", code: "ABORT_ERR" });
};

test("bare, on a terminal with nothing configured: the whole guide, from a name to the schedule", async () => {
  const g = harness({ answers: ["testskolan", "2", ""] });
  const r = await g.run();
  assert.equal(r.code, EXIT.OK, r.err);
  assert.equal(r.out, "", "the bare guide is for people: nothing on stdout");
  assert.deepEqual(g.asked, [
    "What is the school called? (for example Rösjöskolan): ",
    "Which one? Type a number from 1 to 2 and press Enter [1]: ",
    "Press Enter to open the browser: ",
  ]);
  // the chosen school is the current account
  const cfg = g.config();
  assert.equal(cfg.account, "schoolsoft:testskola");
  assert.deepEqual(cfg.accounts["schoolsoft:testskola"], { school: "testskola", orgId: "21" });
  assert.equal(g.h.strategy.loginCalls, 1);
  for (const expected of [
    "Welcome to schoolsoft-agent.",
    "It is not made by SchoolSoft AB or by BankID.",
    "Press Ctrl+C at any time to stop. To continue later, run: schoolsoft-agent setup",
    "Step 1 of 5: Find the school",
    "  1. Påhittade kommun - Testskolan",
    "  2. Påhittade kommun - Testskolan Norra",
    "Found: Påhittade kommun - Testskolan Norra",
    "Step 2 of 5: Save the settings",
    `Saved: short name testskola, in ${join(g.configDir, "config.json")}`,
    "Step 3 of 5: Log in with BankID",
    "Never type BankID codes or passwords here.",
    "Logged in as Test Testsson.",
    "Step 4 of 5: Check that it works",
    "Everything works: 8 of 8 checks passed.",
    "Found 2 children on your account.",
    "Step 5 of 5: This week's schedule",
    "Mon 2026-08-31",
    "  08:30–09:50  Matematik  A12",
    "Your other children: schoolsoft-agent list-children --format text",
    "Done. schoolsoft-agent is ready.",
    `Settings: ${g.configDir}`,
    `Your login, encrypted: ${g.stateDir}`,
    "https://github.com/grimen/schoolsoft-agent/blob/main/docs/getting-started/data-handling.md",
    "Claude Desktop (short name testskola): https://github.com/grimen/schoolsoft-agent/blob/main/docs/integrations/claude/desktop.md",
    "ChatGPT: https://github.com/grimen/schoolsoft-agent/blob/main/docs/integrations/openai/chatgpt.md",
    "Other assistants: https://github.com/grimen/schoolsoft-agent/blob/main/docs/integrations/README.md",
    "schoolsoft-agent get-schedule --format text",
  ])
    assert.ok(r.err.includes(expected), `missing: ${expected}\n---\n${r.err}`);
  assert.ok(!r.err.includes("\u001b["), "no escape codes in the guide");
});

test("bare: help and exit 6 whenever the guide's conditions do not all hold", async () => {
  const cases: Options[] = [
    { noPrompt: true }, // stdin is not a terminal
    { isTTY: false }, // stdout is not a terminal
    { env: { CI: "true" } },
  ];
  for (const o of cases) {
    const g = harness(o);
    const r = await g.run();
    assert.equal(r.code, EXIT.INPUT, JSON.stringify(o));
    assert.match(r.err, /Usage: schoolsoft-agent/);
    assert.deepEqual(g.asked, []);
    assert.equal(existsSync(join(g.configDir, "config.json")), false);
  }
  // configured already (the environment names a school): help, as before
  const env = harness({ env: { SCHOOLSOFT_SCHOOL: "testskola" } });
  const r = await env.run();
  assert.equal(r.code, EXIT.INPUT);
  assert.match(r.err, /Usage: schoolsoft-agent/);
  // a broken config.json is not "unconfigured": help, and the next command reports it
  const broken = harness();
  writeFileSync(join(broken.configDir, "config.json"), "{ not json");
  assert.equal((await broken.run()).code, EXIT.INPUT);
  assert.deepEqual(broken.asked, []);
});

test("setup without a terminal and nothing configured: not configured, exit 3, nothing sent", async () => {
  const g = harness({ noPrompt: true });
  const r = await g.run("setup");
  assert.equal(r.code, EXIT.NOT_CONFIGURED);
  assert.equal(r.out, "");
  assert.match(r.err, /Not configured/);
  assert.match(r.err, /Next: Run: schoolsoft-agent configure/);
  assert.equal(g.h.strategy.loginCalls, 0);
});

test("setup --query on a terminal: no prompt, best match, JSON result on stdout", async () => {
  const g = harness({ answers: [] });
  const r = await g.run("setup", "--query", "testskolan");
  assert.equal(r.code, EXIT.OK, r.err);
  assert.deepEqual(g.asked, [], "an answer flag means no questions");
  assert.deepEqual(g.config().accounts["schoolsoft:testskola"], {
    school: "testskola",
    orgId: "20",
  });
  assert.match(r.err, /Found: Påhittade kommun - Testskolan\n/);
  assert.match(r.err, /Opening SchoolSoft's login page in your browser/);
  assert.deepEqual(JSON.parse(r.out), {
    status: "ready",
    school: "testskola",
    configDir: g.configDir,
    stateDir: g.stateDir,
    children: 2,
    check: { ok: 8, drift: 0, skipped: 7, error: 0 },
  });
  // --pretty applies; --format text leaves stdout empty (the guide is the text)
  const pretty = await g.run("--pretty", "setup", "--query", "testskolan");
  assert.match(pretty.out, /\n {2}"status": "ready"/);
  const text = await g.run("--format", "text", "setup", "--query", "testskolan");
  assert.equal(text.code, EXIT.OK);
  assert.equal(text.out, "");
  assert.match(text.err, /Everything works/);
});

test("setup --query without a match: school_not_found, exit 6, nothing saved", async () => {
  const g = harness({ noPrompt: true });
  const r = await g.run("setup", "--query", "zzzz");
  assert.equal(r.code, EXIT.INPUT);
  assert.match(r.err, /No school in SchoolSoft's public list matched "zzzz"\./);
  assert.match(r.err, /Next: Try part of the school's name/);
  assert.equal(existsSync(join(g.configDir, "config.json")), false);
});

test("setup --school --org-id --no-login without a saved login: school saved, then exit 2", async () => {
  const g = harness();
  const r = await g.run("--school", "annan", "--org-id", "30", "setup", "--no-login");
  assert.equal(r.code, EXIT.NOT_AUTHENTICATED);
  assert.deepEqual(g.asked, []);
  assert.equal(r.out, "");
  assert.deepEqual(g.config().accounts["schoolsoft:annan"], { school: "annan", orgId: "30" });
  assert.match(r.err, /Saved: short name annan/);
  assert.match(r.err, /Not logged in to SchoolSoft/);
  assert.match(r.err, /Next: Run: schoolsoft-agent login/);
  assert.equal(g.h.strategy.loginCalls, 0, "--no-login never starts BankID");
  // --school alone (no org id) is saved as given too
  const plain = harness({ noPrompt: true });
  await plain.h.manager.login();
  const p = await plain.run("--school", "annan", "setup");
  assert.equal(p.code, EXIT.OK, p.err);
  assert.deepEqual(plain.config().accounts["schoolsoft:annan"], { school: "annan" });
});

test("setup again: a chosen school and a saved login are kept, no questions", async () => {
  const g = harness({ answers: [] });
  assert.equal(
    (await g.run("setup", "--query", "testskolan", "--no-login")).code,
    EXIT.NOT_AUTHENTICATED,
  );
  await g.h.manager.login();
  g.h.strategy.loginCalls = 0;
  const r = await g.run("setup");
  assert.equal(r.code, EXIT.OK, r.err);
  assert.deepEqual(g.asked, []);
  assert.match(r.err, /Already done: your school is chosen \(short name testskola\)\./);
  assert.match(r.err, /To choose another school later, run: schoolsoft-agent configure/);
  assert.match(r.err, new RegExp(`Already done: your settings are in ${g.configDir}`));
  assert.match(r.err, /Already done: you are logged in\./);
  assert.equal(g.h.strategy.loginCalls, 0);
  assert.equal(JSON.parse(r.out).status, "ready");
});

test("interactive answers are asked again: empty, no match, bad numbers (Enter picks 1); three tries, then cancelled", async () => {
  const g = harness({ answers: ["", "zzzz", "testskolan", "9", "x", "", ""] });
  const r = await g.run("setup");
  assert.equal(r.code, EXIT.OK, r.err);
  assert.match(r.err, /Type the school's name, or part of it, and press Enter\./);
  assert.match(r.err, /No school matched "zzzz"\. Try part of the name, or the municipality\./);
  assert.match(r.err, /Please type a number from 1 to 2\./);
  assert.equal(g.config().accounts["schoolsoft:testskola"].orgId, "20");
  // a single match needs no number
  const one = harness({ answers: ["ängs", ""] });
  assert.equal((await one.run("setup")).code, EXIT.OK);
  assert.equal(one.asked.length, 2);
  assert.equal(one.config().account, "schoolsoft:annan");

  const noMatch = harness({ answers: ["zzzz", "yyyy", "xxxx"] });
  const n = await noMatch.run("setup");
  assert.equal(n.code, EXIT.INPUT);
  assert.match(n.err, /No school in SchoolSoft's public list matched "xxxx"\./);

  const badPick = harness({ answers: ["testskolan", "0", "3", "-1"] });
  const b = await badPick.run("setup");
  assert.equal(b.code, EXIT.INPUT);
  assert.match(b.err, /Stopped before finishing; nothing more was changed\./);
  assert.equal(existsSync(join(badPick.configDir, "config.json")), false);

  const empty = harness({ answers: ["", " ", ""] });
  assert.equal((await empty.run("setup")).code, EXIT.INPUT);
});

test("Ctrl+C at a question: cancelled, exit 6, two lines, nothing saved", async () => {
  const g = harness({ answers: [ctrlC] });
  const r = await g.run();
  assert.equal(r.code, EXIT.INPUT);
  const lines = r.err.split("\n");
  assert.equal(lines.at(-2), "Stopped before finishing; nothing more was changed.");
  assert.equal(
    lines.at(-1),
    "Next: Run schoolsoft-agent setup when you are ready; it continues where you left off",
  );
  assert.equal(existsSync(join(g.configDir, "config.json")), false);
  // at the browser question: the school is saved, no login started
  const late = harness({ answers: ["ängs", ctrlC] });
  assert.equal((await late.run("setup")).code, EXIT.INPUT);
  assert.equal(late.config().account, "schoolsoft:annan");
  assert.equal(late.h.strategy.loginCalls, 0);
});

test("a check that drifts: two lines, check_failed on stdout, exit 7, no schedule", async () => {
  const portal = {
    ...fakePortal,
    getScheduleWeek: async () => {
      throw new ResponseDriftError("getScheduleWeek", "0.startDate invalid_type");
    },
  } as unknown as Portal;
  const g = harness({ portal });
  const r = await g.run("setup", "--query", "testskolan");
  assert.equal(r.code, EXIT.UPSTREAM);
  const lines = r.err.split("\n");
  assert.equal(lines.at(-2), "Something does not work yet: 1 of 8 checks did not pass.");
  assert.match(lines.at(-1)!, /^Next: run schoolsoft-agent doctor --verify for details/);
  assert.doesNotMatch(r.err, /Step 5 of 5/);
  const data = JSON.parse(r.out);
  assert.equal(data.status, "check_failed");
  // skipped, not failed: bookings and files (no browser here), the gated pages (no web login)
  // and the criteria (they need a subject)
  assert.deepEqual(data.check, { ok: 7, drift: 1, skipped: 7, error: 0 });

  // an error that is not drift exits by its kind (network: 4)
  const down = harness({
    portal: {
      ...fakePortal,
      getInbox: async () => {
        throw new NetworkError("ECONNRESET");
      },
    } as unknown as Portal,
  });
  const d = await down.run("setup", "--query", "testskolan");
  assert.equal(d.code, EXIT.NETWORK);
  assert.equal(JSON.parse(d.out).check.error, 1);
});

test("the login: its address is shown once when known; a failed login keeps its own exit code", async (t) => {
  class WithUrl extends MemoryPendingLoginStore {
    override write(p: PendingLogin): void {
      super.write(
        p.state === "running" ? { ...p, url: "https://sms.example.test/login?state=s" } : p,
      );
    }
  }
  const g = harness({ pending: new WithUrl() });
  const r = await g.run("setup", "--query", "testskolan");
  assert.equal(r.code, EXIT.OK, r.err);
  const shown = r.err
    .split("\n")
    .filter((l) => l.includes("https://sms.example.test/login?state=s"));
  assert.deepEqual(shown, [
    "If no browser window opened, open this address on this computer: https://sms.example.test/login?state=s",
  ]);

  // a slow login: the guide keeps waiting until it ends
  const slow = harness();
  const login = slow.h.manager.login.bind(slow.h.manager);
  t.mock.method(
    slow.h.manager,
    "login",
    async () => new Promise((resolve) => setTimeout(() => resolve(login()), 300)),
  );
  const s = await slow.run("setup", "--query", "testskolan");
  assert.equal(s.code, EXIT.OK, s.err);
  assert.match(s.err, /Waiting for you to finish in the browser/);

  // a login that fails: its own error and exit code, after the school is saved
  const failed = harness();
  t.mock.method(failed.h.manager, "login", async () => {
    throw new NetworkError("ETIMEDOUT");
  });
  const f = await failed.run("setup", "--query", "testskolan");
  assert.equal(f.code, EXIT.NETWORK);
  assert.match(f.err, /Could not reach SchoolSoft \(ETIMEDOUT\)/);
  assert.equal(failed.config().account, "schoolsoft:testskola");

  // a login that returns no name still says it is done
  const nameless = harness();
  const original = nameless.h.strategy.login.bind(nameless.h.strategy);
  t.mock.method(nameless.h.strategy, "login", async (session: never) => ({
    ...(await original(session)),
    name: null,
  }));
  const n = await nameless.run("setup", "--query", "testskolan");
  assert.equal(n.code, EXIT.OK, n.err);
  assert.match(n.err, /^Logged in\.$/m);
});

test("errors other than 'not logged in' while checking the saved login stop the guide", async (t) => {
  const g = harness();
  t.mock.method(g.h.manager, "ensureSession", async () => {
    throw new NetworkError("ENOTFOUND");
  });
  const r = await g.run("setup", "--query", "testskolan");
  assert.equal(r.code, EXIT.NETWORK);
  assert.equal(g.h.strategy.loginCalls, 0);
});

test("one child: no line about other children", async () => {
  const store = new MemorySessionStore();
  store.save({
    provider: "schoolsoft",
    school: "testskola",
    data: { accessToken: "tok", refreshToken: "ref" },
    savedAt: Date.now(),
    authMethod: "fake",
    guardian: { ...CONTEXT, children: [CONTEXT.children[0]] },
  });
  const g = harness({ store, noPrompt: true });
  const r = await g.run("setup", "--query", "testskolan");
  assert.equal(r.code, EXIT.OK, r.err);
  assert.match(r.err, /Found 1 child on your account\./);
  assert.doesNotMatch(r.err, /Your other children/);
  assert.equal(JSON.parse(r.out).children, 1);
});

test("Swedish: every line of the guide in Swedish, from the locale or SCHOOLSOFT_LANG", async () => {
  const envs: Record<string, string>[] = [{ LANG: "sv_SE.UTF-8" }, { SCHOOLSOFT_LANG: "sv" }];
  for (const env of envs) {
    const g = harness({ answers: ["testskolan", "1", ""], env });
    const r = await g.run();
    assert.equal(r.code, EXIT.OK, r.err);
    assert.deepEqual(g.asked, [
      "Vad heter skolan? (till exempel Rösjöskolan): ",
      "Vilken? Skriv en siffra från 1 till 2 och tryck Enter [1]: ",
      "Tryck Enter för att öppna webbläsaren: ",
    ]);
    for (const expected of [
      "Välkommen till schoolsoft-agent.",
      "Steg 1 av 5: Hitta skolan",
      "Steg 3 av 5: Logga in med BankID",
      "Allt fungerar: 8 av 8 kontroller gick bra.",
      "Hittade 2 barn på ditt konto.",
      "mån 2026-08-31",
      "Klart. schoolsoft-agent är redo.",
      "Var dina uppgifter finns",
    ])
      assert.ok(r.err.includes(expected), `missing: ${expected}`);
    assert.doesNotMatch(r.err, /\b(Step|Welcome|Everything works|Where your data is)\b/);
  }
  const cancelled = harness({ answers: [ctrlC], env: { SCHOOLSOFT_LANG: "sv" } });
  const c = await cancelled.run("setup");
  assert.match(c.err, /Avbrutet innan det blev klart; inget mer ändrades\.\nNästa steg: Kör/);
});

test("under npx the commands it suggests start with npx -y schoolsoft-agent", async () => {
  const g = harness({ env: { npm_command: "exec" } });
  const r = await g.run("setup", "--query", "testskolan");
  assert.equal(r.code, EXIT.OK, r.err);
  assert.match(r.err, /^ {2}npx -y schoolsoft-agent get-schedule --format text/m);
  assert.match(r.err, /To continue later, run: npx -y schoolsoft-agent setup/);
});
