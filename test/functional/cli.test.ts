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
import { makeContext } from "../helpers/fakes.js";

function harness(
  opts: {
    ctx?: ReturnType<typeof makeContext>["ctx"];
    unconfigured?: boolean;
    prompt?: CliDeps["prompt"];
    env?: Record<string, string>;
    home?: string;
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
