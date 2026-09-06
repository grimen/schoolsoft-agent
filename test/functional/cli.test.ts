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
    browserSession?: CliDeps["browserSession"];
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
    platform: "linux",
    version: "9.9.9",
    prompt: opts.prompt,
    fetchImpl: async () => ({ status: 200 }),
    browserSession: opts.browserSession,
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

test("exit codes: not authenticated → 2, not configured → 3, error → 1, usage → 1", async () => {
  const { run } = harness();
  const na = await run("get-news");
  assert.equal(na.code, EXIT.NOT_AUTHENTICATED);
  assert.match(na.err, /schoolsoft-agent login/);

  const nc = harness({ unconfigured: true });
  const r3 = await nc.run("get-news");
  assert.equal(r3.code, EXIT.NOT_CONFIGURED);
  assert.match(r3.err, /configure/);
  // a --school override satisfies configuration
  assert.equal((await nc.run("--school", "taby", "login")).code, EXIT.OK);
  assert.equal((await nc.run("--school", "taby", "list-children")).code, EXIT.OK);

  await run("login");
  const bad = await run("get-schedule", "--child-id", "999");
  assert.equal(bad.code, EXIT.ERROR);
  assert.match(bad.err, /Unknown child id 999/);
  assert.equal((await run("get-schedule", "--week", "abc")).code, EXIT.ERROR);
  assert.equal((await run("no-such-command")).code, EXIT.ERROR);
  assert.equal((await run("find-school")).code, EXIT.ERROR, "required --query missing");
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

test("a browser-backed command without a browser fails with the install hint (exit 1)", async () => {
  const { run } = harness({
    ctx: makeContext({ browserUnavailable: "playwright is not installed" }).ctx,
  });
  assert.equal((await run("login")).code, EXIT.OK);
  const r = await run("get-contacts");
  assert.equal(r.code, EXIT.ERROR);
  assert.match(r.err, /schoolsoft-agent browser install/);
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
  const { createCompositePortal, BrowserPortal } = await import("../../src/core/index.js");
  const session = {
    withPage: async () => {
      throw new Error("must not navigate");
    },
    close: async () => {},
  };
  const portal = createCompositePortal({
    api: fakePortal as never,
    browser: new BrowserPortal({ session, hasWebSession: () => false }),
  });
  const { run } = harness({ ctx: makeContext({ portal }).ctx });
  assert.equal((await run("login")).code, EXIT.OK);
  const r = await run("get-grades");
  assert.equal(r.code, EXIT.ERROR);
  assert.match(r.err, /login --web/);
  assert.equal(
    (await run("get-contacts")).code,
    EXIT.ERROR,
    "non-gated browser page tries to navigate (fake session throws)",
  );
});

test("browser verify reports every page, exit 0 when ok/drift and 1 when a page is broken", async () => {
  const { PAGES } = await import("../../src/core/index.js");
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
