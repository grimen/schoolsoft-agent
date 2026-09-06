/**
 * Functional: the commander program invoked in-process with a fake
 * context. Asserts JSON shapes, flag plumbing, exit codes, configure and
 * doctor behaviour. No network, no real filesystem beyond a temp dir.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli, type CliDeps } from "../../src/cli/program.js";
import { EXIT } from "../../src/cli/exit-codes.js";
import { NotConfiguredError, type ConfigSource } from "../../src/core/index.js";
import { makeContext, fakePortal } from "../helpers/fakes.js";

function harness(
  opts: {
    ctx?: ReturnType<typeof makeContext>["ctx"];
    unconfigured?: boolean;
    prompt?: CliDeps["prompt"];
    env?: Record<string, string>;
    home?: string;
    platform?: NodeJS.Platform;
    browserSession?: CliDeps["browserSession"];
    detach?: CliDeps["detach"];
  } = {},
) {
  const out: string[] = [];
  const err: string[] = [];
  const h = makeContext();
  const deps: CliDeps = {
    getContext: (overrides: ConfigSource) => {
      if (opts.unconfigured && !overrides.school) throw new NotConfiguredError("no school slug");
      return opts.ctx ?? h.ctx;
    },
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    env: opts.env ?? {},
    home: opts.home ?? mkdtempSync(join(tmpdir(), "home-")),
    platform: opts.platform ?? "linux",
    version: "9.9.9",
    prompt: opts.prompt,
    fetchImpl: async () => ({ status: 200 }),
    browserSession: opts.browserSession,
    detach: opts.detach,
  };
  const run = async (...argv: string[]) => {
    out.length = 0;
    err.length = 0;
    const code = await runCli(argv, deps);
    return {
      code,
      out: out.join("\n"),
      err: err.join("\n"),
      json: () => JSON.parse(out.join("\n")),
    };
  };
  return { run, deps, h };
}

test("--version and --help exit 0", async () => {
  const { run } = harness();
  const v = await run("--version");
  assert.equal(v.code, EXIT.OK);
  assert.equal(v.out.trim(), "9.9.9");
  const hlp = await run("--help");
  assert.equal(hlp.code, EXIT.OK);
  assert.match(hlp.out, /get-schedule/);
  assert.match(hlp.out, /find-school/);
  assert.match(hlp.out, /configure/);
});

test("operation commands: flags map to args, JSON on stdout, child in output", async () => {
  const { run } = harness();
  assert.equal((await run("login")).code, EXIT.OK);
  const r = await run("get-schedule", "--week", "35", "--child-id", "101");
  assert.equal(r.code, EXIT.OK, r.err);
  const data = r.json();
  assert.equal(data.week, 35);
  assert.equal(data.child.studentId, 101);
  assert.equal(data.lessons.length, 2);
  const u = await run("get-messages", "--unread-only", "--pretty");
  assert.equal(u.code, EXIT.OK);
  assert.match(u.out, /\n  "messages"/, "pretty output is indented");
  assert.deepEqual(
    u.json().messages.map((m: { id: number }) => m.id),
    [5],
  );
});

test("exit codes: not authenticated → 2, not configured → 3, bad input → 6, unknown command → 6", async () => {
  const { run } = harness();
  const na = await run("get-news");
  assert.equal(na.code, EXIT.NOT_AUTHENTICATED);
  assert.match(na.err, /Not logged in/);
  assert.match(na.err, /Next: Run: schoolsoft-agent login/);

  const nc = harness({ unconfigured: true });
  const r3 = await nc.run("get-news");
  assert.equal(r3.code, EXIT.NOT_CONFIGURED);
  assert.match(r3.err, /configure/);
  // a --school override satisfies configuration
  assert.equal((await nc.run("--school", "taby", "login")).code, EXIT.OK);
  assert.equal((await nc.run("--school", "taby", "list-children")).code, EXIT.OK);

  await run("login");
  const bad = await run("get-schedule", "--child-id", "999");
  assert.equal(bad.code, EXIT.INPUT);
  assert.match(bad.err, /No child with id 999/);
  assert.match(bad.err, /Next: Run: schoolsoft-agent list-children/);
  assert.equal((await run("get-schedule", "--week", "abc")).code, EXIT.INPUT);
  assert.equal((await run("no-such-command")).code, EXIT.INPUT);
  assert.equal((await run("find-school")).code, EXIT.INPUT, "required --query missing");
});

test("configure: non-interactive with --school/--org-id writes config.json", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cfg-"));
  const { run } = harness();
  const r = await run("--config-dir", dir, "--school", "taby", "--org-id", "20", "configure");
  assert.equal(r.code, EXIT.OK, r.err);
  const written = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
  assert.deepEqual(written, { school: "taby", orgId: "20" });
  assert.equal(r.json().status, "configured");
});

test("configure: --query resolves via the cached school list; interactive picks by number", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cfg-"));
  writeFileSync(
    join(dir, "schools.json"),
    JSON.stringify({
      fetchedAt: Date.now(),
      schools: [
        { name: "Täby kommun - Rösjöskolan", slug: "taby", orgId: 20 },
        { name: "Täby kommun - Skolhagenskolan", slug: "taby", orgId: 18 },
      ],
    }),
  );
  const { run } = harness();
  const r = await run("--config-dir", dir, "configure", "--query", "rösjö");
  assert.equal(r.code, EXIT.OK, r.err);
  assert.deepEqual(r.json().config, { school: "taby", orgId: "20" });

  const answers = ["täby", "2"];
  const inter = harness({ prompt: async () => answers.shift() ?? "" });
  const r2 = await inter.run("--config-dir", dir, "configure");
  assert.equal(r2.code, EXIT.OK, r2.err);
  assert.equal(r2.json().config.orgId, "18");

  const none = harness();
  assert.equal((await none.run("--config-dir", dir, "configure")).code, EXIT.ERROR);
});

test("doctor: reports checks, exit 1 when unconfigured, --fix migrates a legacy store", async () => {
  const home = mkdtempSync(join(tmpdir(), "home-"));
  const dir = join(home, "cfg");
  const { run } = harness({ home });
  const bad = await run("--config-dir", dir, "doctor");
  assert.equal(bad.code, EXIT.ERROR);
  const checks = bad.json().checks as { name: string; ok: boolean }[];
  assert.equal(checks.find((c) => c.name === "config")?.ok, false);
  assert.equal(checks.find((c) => c.name === "network")?.ok, true);

  mkdirSync(join(home, ".schoolsoft-mcp"), { recursive: true });
  writeFileSync(join(home, ".schoolsoft-mcp", "session.enc"), "blob");
  writeFileSync(join(home, ".schoolsoft-mcp", "key.bin"), "key");
  const warn = await run("--config-dir", dir, "--school", "taby", "doctor");
  assert.match(warn.out, /doctor --fix/);
  const fixed = await run("--config-dir", dir, "--school", "taby", "doctor", "--fix");
  assert.ok(existsSync(join(dir, "state", "session.enc")));
  assert.match(fixed.out, /moved/);
});

test("browser status/install use injected probes and spawner; cdp engine needs nothing", async () => {
  const { run, deps } = harness();
  deps.browserProbes = {
    resolvePlaywright: () => "/x/playwright/package.json",
    chromiumPath: async () => "/nonexistent",
  };
  const spawned: string[][] = [];
  deps.spawner = async (cmd, args) => {
    spawned.push([cmd, ...args]);
    return 0;
  };
  const st = await run("browser", "status");
  assert.equal(st.code, EXIT.OK, st.err);
  assert.equal(st.json().ready, false);
  assert.match(st.json().hint, /browser install/);
  const inst = await run("browser", "install");
  assert.equal(inst.code, EXIT.OK, inst.err);
  assert.deepEqual(spawned[0].slice(1), ["/x/playwright/cli.js", "install", "chromium"]);
  const cdp = await run("--school", "taby", "browser", "install");
  assert.equal(cdp.code, EXIT.OK);
  deps.env.SCHOOLSOFT_BROWSER_ENGINE = "cdp";
  deps.env.SCHOOLSOFT_BROWSER_CDP = "ws://obscura:9222";
  const cdp2 = await run("--school", "taby", "browser", "install");
  assert.equal(cdp2.json().status, "not_needed");
});

test("a browser-backed command without a browser fails with the install hint (exit 5)", async () => {
  const { run } = harness({
    ctx: makeContext({ browserUnavailable: "playwright is not installed" }).ctx,
  });
  assert.equal((await run("login")).code, EXIT.OK);
  const r = await run("get-contacts");
  assert.equal(r.code, EXIT.NOT_AVAILABLE);
  assert.match(r.err, /headless browser/);
  assert.match(r.err, /playwright is not installed/);
  const ok = await run("get-activity-log", "--limit", "1");
  assert.equal(ok.code, EXIT.OK, "activity log is api-backed and still works");
  assert.equal(ok.json().entries.length, 1);
});

test("login --web runs the web login and auth-status reports the web session", async () => {
  const h = makeContext({
    webLogin: async () => ({
      cookies: [{ name: "JSESSIONID", value: "w", domain: "sms.schoolsoft.se", path: "/" }],
      savedAt: Date.now(),
      landedOn: "https://sms.schoolsoft.se/testskola/jsp/student/right_student_startpage.jsp",
    }),
  });
  const { run } = harness({ ctx: h.ctx });
  assert.equal((await run("login")).code, EXIT.OK);
  const w = await run("login", "--web");
  assert.equal(w.code, EXIT.OK, w.err);
  assert.equal(w.json().status, "web_logged_in");
  assert.equal(w.json().cookies, 1);
  const st = await run("auth-status");
  assert.equal(st.json().webSession.cookies, 1);
});

test("a gated command without a web session fails with the login --web hint", async () => {
  const { createCompositePortal } = await import("../../src/core/index.js");
  const { BrowserPortal, ROUTING } = await import("../../src/providers/schoolsoft/index.js");
  const session = {
    withPage: async () => {
      throw new Error("must not navigate");
    },
    close: async () => {},
  };
  const portal = createCompositePortal({
    routing: ROUTING,
    api: fakePortal as never,
    browser: new BrowserPortal({ session, hasWebSession: () => false }),
  });
  const { run } = harness({ ctx: makeContext({ portal }).ctx });
  assert.equal((await run("login")).code, EXIT.OK);
  const r = await run("get-grades");
  assert.equal(r.code, EXIT.NOT_AUTHENTICATED);
  assert.match(r.err, /web login session/);
  assert.match(r.err, /Next: Run: schoolsoft-agent login --web/);
  assert.equal(
    (await run("get-contacts")).code,
    EXIT.ERROR,
    "non-gated browser page tries to navigate (fake session throws)",
  );
});

test("browser verify reports every page, exit 0 when ok/drift and 1 when a page is broken", async () => {
  const { PAGES } = await import("../../src/providers/schoolsoft/index.js");
  const make = (missing: string | null) => ({
    withPage: async (fn: (p: unknown) => Promise<unknown>) => {
      let current = "";
      return fn({
        goto: async (p: string) => {
          current = p;
        },
        url: () => current,
        evaluate: async (f: { name: string }, arg?: string[]) =>
          f.name === "extractSubjectLinks"
            ? [{ subject: "Bild", url: "x", subjectId: 1 }]
            : {
                title: "T",
                anchors: Object.fromEntries((arg ?? []).map((a) => [a, a === missing ? 0 : 1])),
                fingerprint: "00",
                nodes: 1,
              },
        waitForJson: async () => ({}),
      });
    },
    close: async () => {},
  });
  const ok = harness({ ctx: makeContext().ctx, browserSession: () => make(null) as never });
  assert.equal((await ok.run("login")).code, EXIT.OK);
  const r = await ok.run("browser", "verify");
  assert.equal(r.code, EXIT.OK, r.err);
  assert.ok(
    ["ok", "drift"].includes(r.json().status),
    "fake fingerprints differ from the recorded ones: drift, not broken",
  );
  assert.equal(r.json().pages.length, Object.keys(PAGES).length);
  assert.ok(
    r.json().pages.some((p: { status: string }) => p.status === "skipped"),
    "gated pages skipped without web session",
  );
  const broken = harness({
    ctx: makeContext().ctx,
    browserSession: () => make("#contAll_content") as never,
  });
  await broken.run("login");
  const b = await broken.run("browser", "verify");
  assert.equal(b.code, EXIT.ERROR);
  assert.match(b.err, /contacts/);
});

test("unexpected errors exit 1 with the message; configure edge cases; doctor details", async () => {
  const boom = makeContext({
    portal: {
      ...fakePortal,
      getScheduleWeek: async () => {
        throw new Error("upstream exploded");
      },
    } as never,
  });
  const h = harness({ ctx: boom.ctx });
  await h.run("login");
  const r = await h.run("get-schedule");
  assert.equal(r.code, EXIT.ERROR);
  assert.match(r.err, /Unexpected error: upstream exploded/);

  // configure: config dir from env, then from the platform default; school only (no org id)
  const home = mkdtempSync(join(tmpdir(), "home-"));
  const envDir = join(home, "envcfg");
  const viaEnv = harness({ home, env: { SCHOOLSOFT_CONFIG_DIR: envDir } });
  const c1 = await viaEnv.run("--school", "taby", "configure");
  assert.equal(c1.code, EXIT.OK, c1.err);
  assert.deepEqual(c1.json().config, { school: "taby" });
  assert.ok(existsSync(join(envDir, "config.json")));
  const viaDefault = harness({ home });
  const c2 = await viaDefault.run("--school", "taby", "configure");
  assert.match(c2.json().file, /\.config\/schoolsoft-agent\/config\.json$/);

  // configure: no match, default pick, invalid pick
  const dir = mkdtempSync(join(tmpdir(), "cfg-"));
  writeFileSync(
    join(dir, "schools.json"),
    JSON.stringify({
      fetchedAt: Date.now(),
      schools: [
        { name: "Täby kommun - Rösjöskolan", slug: "taby", orgId: 20 },
        { name: "Täby kommun - Skolhagenskolan", slug: "taby", orgId: 18 },
      ],
    }),
  );
  const none = await harness().run("--config-dir", dir, "configure", "--query", "zzzz");
  assert.equal(none.code, EXIT.ERROR);
  assert.match(none.err, /No school matched/);
  const answers = ["täby", ""];
  const dflt = harness({ prompt: async () => answers.shift() ?? "" });
  const d = await dflt.run("--config-dir", dir, "configure");
  assert.equal(d.code, EXIT.OK, d.err);
  assert.equal(d.json().config.orgId, "20", "empty answer picks the first hit");
  const bad = ["täby", "9"];
  const invalid = harness({ prompt: async () => bad.shift() ?? "" });
  const i = await invalid.run("--config-dir", dir, "configure");
  assert.equal(i.code, EXIT.ERROR);
  assert.match(i.err, /Invalid choice/);

  // doctor: invalid config (not a NotConfiguredError), saved session detail, network failure, browser ready detail
  const bogus = harness({ env: { SCHOOLSOFT_CALLBACK_PORT: "abc" } });
  const dr = await bogus.run("--config-dir", dir, "--school", "taby", "doctor");
  const cfgCheck = dr.json().checks.find((c: { name: string }) => c.name === "config");
  assert.equal(cfgCheck.ok, false);
  assert.doesNotMatch(cfgCheck.detail, /not configured/);

  const { FileSessionStore } = await import("../../src/core/index.js");
  const stateDir = join(dir, "state");
  new FileSessionStore(stateDir).save({
    school: "taby",
    data: {},
    savedAt: 1,
    authMethod: "bankid-browser",
  });
  const ok = harness();
  ok.deps.fetchImpl = async () => {
    throw new Error("offline");
  };
  ok.deps.browserProbes = {
    resolvePlaywright: () => "/x/package.json",
    chromiumPath: async () => process.execPath,
  };
  const d2 = await ok.run("--config-dir", dir, "--school", "taby", "doctor");
  const by = Object.fromEntries(
    d2.json().checks.map((c: { name: string; detail: string; ok: boolean }) => [c.name, c]),
  );
  assert.match(
    by.session.detail,
    /saved 1970-01-01T00:00:00\.001Z via bankid-browser, children=\?/,
  );
  assert.match(by.network.detail, /unreachable: offline/);
  assert.match(
    by["headless-browser"].detail,
    new RegExp(`ready \\(chromium, ${process.execPath.replace(/[/\\]/g, "[/\\\\]")}\\)`),
  );
  assert.equal(by.network.ok, false);
});

test("browser install: failing spawner exits 1, ready chromium reports installed; engineFor survives a bad config; defaultBrowserSession builds a session", async () => {
  const { run, deps } = harness();
  deps.browserProbes = {
    resolvePlaywright: () => "/x/playwright/package.json",
    chromiumPath: async () => process.execPath,
  };
  deps.spawner = async () => 2;
  const bad = await run("browser", "install");
  assert.equal(bad.code, EXIT.ERROR);
  assert.match(bad.err, /exited with 2/);
  deps.spawner = async () => 0;
  const good = await run("browser", "install");
  assert.equal(good.json().status, "installed");
  const broken = harness({ env: { SCHOOLSOFT_CALLBACK_PORT: "abc" } });
  broken.deps.browserProbes = deps.browserProbes;
  const st = await broken.run("browser", "status");
  assert.equal(
    st.json().engine,
    "chromium",
    "unparseable config falls back to the chromium engine",
  );
  const { defaultBrowserSession } = await import("../../src/cli/commands/browser.js");
  const ctx = makeContext().ctx;
  const session = defaultBrowserSession(ctx);
  assert.equal(typeof session.withPage, "function");
  await session.close();
});

test("non-Error throws, doctor platform/engine/session variants, verify without drift and the production session", async () => {
  const stringy = makeContext({
    portal: {
      ...fakePortal,
      getScheduleWeek: async () => {
        throw "not an error object";
      },
    } as never,
  });
  const h = harness({ ctx: stringy.ctx });
  await h.run("login");
  const r = await h.run("get-schedule");
  assert.equal(r.code, EXIT.ERROR);
  assert.match(r.err, /Unexpected error: not an error object/);

  const dir = mkdtempSync(join(tmpdir(), "cfg-"));
  const { FileSessionStore } = await import("../../src/core/index.js");
  new FileSessionStore(join(dir, "state")).save({
    school: "taby",
    data: {},
    savedAt: 1,
    authMethod: "bankid-browser",
    guardian: {
      userId: 1,
      parentName: "P",
      childInFocus: 100,
      children: [{ studentId: 100, firstName: "A", lastName: "B", schools: [] }],
    },
  });
  for (const platform of ["darwin", "win32"] as const) {
    const d = harness({
      platform,
      env: { SCHOOLSOFT_BROWSER_ENGINE: "cdp", SCHOOLSOFT_BROWSER_CDP: "ws://x" },
    });
    d.deps.fetchImpl = async () => {
      throw "offline";
    };
    d.deps.browserProbes = { resolvePlaywright: () => "/x/package.json" };
    const out = await d.run("--config-dir", dir, "--school", "taby", "doctor");
    const by = Object.fromEntries(
      out.json().checks.map((c: { name: string; detail: string }) => [c.name, c.detail]),
    );
    assert.match(by.session, /children=1/);
    assert.match(by.network, /unreachable: offline/);
    assert.equal(by["headless-browser"], "ready (cdp)");
    assert.match(by.browser, platform === "darwin" ? /"open"/ : /"cmd"/);
  }

  // browser not installed: doctor stays ok but says so
  const nb = harness();
  nb.deps.browserProbes = {
    resolvePlaywright: () => "/x/package.json",
    chromiumPath: async () => "/nonexistent",
  };
  const nbOut = await nb.run("--config-dir", dir, "--school", "taby", "doctor");
  assert.match(
    nbOut.json().checks.find((c: { name: string }) => c.name === "headless-browser").detail,
    /not installed — only contact lists.*browser install/,
  );

  // default network probe goes through globalThis.fetch
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({ status: 200 })) as never;
  try {
    const d = harness();
    d.deps.fetchImpl = undefined;
    const out = await d.run("--config-dir", dir, "--school", "taby", "doctor");
    assert.equal(out.json().checks.find((c: { name: string }) => c.name === "network").ok, true);
  } finally {
    globalThis.fetch = realFetch;
  }

  // verify: fake returns the recorded fingerprints → ok
  const { PAGES, FINGERPRINTS } = await import("../../src/providers/schoolsoft/index.js");
  const byPath = Object.fromEntries(Object.entries(PAGES).map(([k, s]) => [s.path, k]));
  const okSession = {
    withPage: async (fn: (p: unknown) => Promise<unknown>) => {
      let current = "";
      return fn({
        goto: async (p: string) => {
          current = p.split("?")[0];
        },
        url: () => current,
        evaluate: async (f: { name: string }, arg?: string[]) =>
          f.name === "extractSubjectLinks"
            ? [{ subject: "Bild", url: "x", subjectId: 1 }]
            : {
                title: "T",
                anchors: Object.fromEntries((arg ?? []).map((a) => [a, 1])),
                fingerprint:
                  FINGERPRINTS[byPath[current] as keyof typeof FINGERPRINTS]?.fingerprint ?? "none",
                nodes: 1,
              },
        waitForJson: async () => ({}),
      });
    },
    close: async () => {},
  };
  const ok = harness({ ctx: makeContext().ctx, browserSession: () => okSession as never });
  await ok.run("login");
  const v = await ok.run("browser", "verify");
  assert.equal(v.code, EXIT.OK, v.err);
  assert.equal(v.json().status, "ok");

  // production session: a CDP endpoint nobody listens on → every page reports an error, exit 1, no network
  const prod = harness({
    ctx: makeContext({ config: { browser: { kind: "cdp", endpoint: "ws://127.0.0.1:1" } } }).ctx,
  });
  await prod.run("login");
  const p = await prod.run("browser", "verify");
  assert.equal(p.code, EXIT.ERROR);
  assert.ok(
    p.json().pages.every((x: { status: string }) => x.status === "error" || x.status === "skipped"),
    p.out,
  );
});

test("login --background hands the blocking login to a detached process and reports its URL; a running one is reported, not duplicated", async () => {
  const { MemoryPendingLoginStore } = await import("../../src/core/index.js");
  const pending = new MemoryPendingLoginStore();
  const { ctx } = makeContext({ pending });
  const spawned: string[][] = [];
  const h = harness({
    ctx,
    detach: (argv) => {
      spawned.push(argv);
      // the "child" records its URL a moment later
      setTimeout(
        () =>
          pending.write({
            state: "running",
            startedAt: Date.now(),
            pid: 4242,
            url: "https://login.example/bg",
          }),
        20,
      );
      return 4242;
    },
  });
  const r = await h.run("--school", "taby", "login", "--background", "--strategy", "fake");
  assert.equal(r.code, EXIT.OK, r.err);
  assert.deepEqual(r.json(), {
    status: "login_started",
    url: "https://login.example/bg",
    pid: 4242,
    next: "Ask the user to complete BankID in the browser window, then run auth-status until authenticated is true.",
  });
  assert.deepEqual(spawned, [["--school", "taby", "login", "--strategy", "fake"]]);
  // already running: no second spawn
  const again = await h.run("login", "--background");
  assert.equal(again.json().status, "login_started");
  assert.equal(again.json().pid, 4242);
  assert.equal(spawned.length, 1);
  // without a detach hook the operation itself runs (in-process background)
  const inProcess = harness({ ctx: makeContext({ pending: new MemoryPendingLoginStore() }).ctx });
  const ip = await inProcess.run("login", "--background");
  assert.equal(ip.json().status, "login_started");
});

test("login --background with a child that never reports a URL returns after the wait without one", async () => {
  const { backgroundLogin } = await import("../../src/cli/program.js");
  const { MemoryPendingLoginStore } = await import("../../src/core/index.js");
  const { ctx } = makeContext({ pending: new MemoryPendingLoginStore() });
  const deps = harness({ ctx, detach: () => 1 }).deps;
  const r = await backgroundLogin(ctx, deps, {}, { background: true }, 30, async () => {});
  assert.equal(r.status, "login_started");
  assert.equal(r.url, undefined);
  assert.equal(r.pid, 1);
});

test("errors render in Swedish when SCHOOLSOFT_LANG=sv; network failures exit 4 with the retry hint", async () => {
  const sv = harness({ env: { SCHOOLSOFT_LANG: "sv" } });
  const r = await sv.run("get-news");
  assert.equal(r.code, EXIT.NOT_AUTHENTICATED);
  assert.match(r.err, /Inte inloggad på SchoolSoft/);
  assert.match(r.err, /Nästa steg: Kör: schoolsoft-agent login/);
  const { NetworkError } = await import("../../src/core/index.js");
  const offline = makeContext({
    portal: {
      ...fakePortal,
      getScheduleWeek: async () => {
        throw new NetworkError("ENOTFOUND");
      },
    } as never,
  });
  const h = harness({ ctx: offline.ctx });
  await h.run("login");
  const n = await h.run("get-schedule");
  assert.equal(n.code, EXIT.NETWORK);
  assert.match(n.err, /Could not reach SchoolSoft \(ENOTFOUND\)/);
  assert.match(n.err, /Next: Try again in a moment/);
});
