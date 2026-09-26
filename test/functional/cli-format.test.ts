/**
 * Functional: `--format` through the commander program in-process. JSON
 * stays byte-identical for every operation (with and without --pretty),
 * typed operations render their text view, the rest fall back to pretty
 * JSON with one note, errors keep their two lines, a bad value is an input
 * error, and escapes appear only on a colour-capable TTY.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli, type CliDeps } from "../../src/cli/program.js";
import { EXIT } from "../../src/cli/exit-codes.js";
import { kebab, flagsFromSchema } from "../../src/cli/flags.js";
import { operations, runOperation, type Portal } from "../../src/core/index.js";
import { makeContext, fakePortal } from "../helpers/fakes.js";
import { INBOX } from "../helpers/text-fixtures.js";

function harness(opts: Partial<CliDeps> & { portal?: Portal } = {}) {
  const configDir = mkdtempSync(join(tmpdir(), "fmt-"));
  writeFileSync(
    join(configDir, "schools.json"),
    JSON.stringify({
      fetchedAt: Date.now(),
      schools: [{ name: "Påhittade kommun - Testskolan", slug: "testskola", orgId: 20 }],
    }),
  );
  const h = makeContext({ config: { configDir }, portal: opts.portal });
  const out: string[] = [];
  const err: string[] = [];
  const deps: CliDeps = {
    getContext: () => h.ctx,
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    env: {},
    home: mkdtempSync(join(tmpdir(), "home-")),
    platform: "linux",
    version: "9.9.9",
    fetchImpl: async () => ({ status: 200 }),
    ...opts,
  };
  const run = async (...argv: string[]) => {
    out.length = 0;
    err.length = 0;
    const code = await runCli(argv, deps);
    return { code, out: out.join("\n"), err: err.join("\n") };
  };
  return { run, h, configDir };
}

/** Flags for an operation's required inputs (and a fixed week), as a user would type them. */
function argsFor(op: (typeof operations)[number]): {
  argv: string[];
  args: Record<string, unknown>;
} {
  const argv: string[] = [];
  const args: Record<string, unknown> = {};
  for (const s of flagsFromSchema(op.input)) {
    if (!s.required) continue;
    const v = s.kind === "number" ? 1 : s.kind === "enum" ? s.choices![0] : "Testskolan";
    argv.push(`--${kebab(s.key)}`, String(v));
    args[s.key] = v;
  }
  if ("week" in op.input) {
    argv.push("--week", "36");
    args.week = 36;
  }
  return { argv, args };
}

test("JSON is byte-identical for every operation: no flag, --format json, --pretty", async () => {
  const { run, h } = harness();
  assert.equal((await run("login")).code, EXIT.OK);
  let succeeded = 0;
  for (const op of operations) {
    const { argv } = argsFor(op);
    const cmd = [kebab(op.name), ...argv];
    const plain = await run(...cmd);
    const json = await run("--format", "json", ...cmd);
    const pretty = await run("--pretty", ...cmd);
    const prettyJson = await run(...cmd, "--format", "json", "--pretty");
    assert.deepEqual(json, plain, `${op.name}: --format json`);
    assert.deepEqual(prettyJson, pretty, `${op.name}: --format json --pretty`);
    assert.equal(pretty.code, plain.code, op.name);
    if (plain.code !== EXIT.OK) continue;
    succeeded++;
    const value = JSON.parse(plain.out);
    assert.equal(plain.out, JSON.stringify(value), `${op.name}: compact as before`);
    assert.equal(pretty.out, JSON.stringify(value, null, 2), `${op.name}: indented as before`);
    assert.equal(plain.err, "", op.name);
    if (op.output !== undefined) {
      const expected = await runOperation(op, h.ctx, argsFor(op).args as never);
      assert.equal(plain.out, JSON.stringify(expected), `${op.name}: the operation's own result`);
    }
    if (op.name === "logout") assert.equal((await run("login")).code, EXIT.OK);
  }
  assert.equal(succeeded, operations.length - 1, "all but report_absence (writes are off) ran");
});

test("JSON golden: get-messages prints exactly today's bytes", async () => {
  const { run } = harness();
  await run("login");
  const r = await run("get-messages", "--limit", "1");
  assert.equal(
    r.out,
    '{"messages":[{"id":5,"subject":"Hej","preview":"Hej!","read":false,"sender":{"name":"Lärare Test"},"sentAt":"2026-09-01T14:05:00+02:00","hasAttachments":false}]}',
  );
});

test("--format text renders the typed operations; nothing on stderr", async () => {
  const now = () => Date.parse("2026-08-31T09:00:00+02:00");
  const { run } = harness({ now });
  await run("login");
  const schedule = await run("get-schedule", "--week", "36", "--format", "text");
  assert.equal(schedule.code, EXIT.OK);
  assert.equal(schedule.err, "");
  assert.equal(
    schedule.out,
    [
      "Week 36 · Ett",
      "",
      "Mon 2026-08-31 (today)",
      "  08:30–09:50  Matematik  A12",
      "  10:10–11:30  Svenska    B03",
    ].join("\n"),
  );
  const kids = await run("--format", "text", "list-children");
  assert.match(kids.out, /^Guardian: Test Testsson\n/);
  assert.match(kids.out, /\*  100  Ett/);
  const lunch = await run("--format", "text", "get-lunch-menu", "--week", "36");
  assert.match(lunch.out, /Fri 2026-09-04 {10}Lunch: Spagetti/);
  const cal = await run(
    "--format",
    "text",
    "get-calendar",
    "--start-date",
    "2026-08-31",
    "--end-date",
    "2026-09-06",
  );
  assert.match(cal.out, /^Calendar 2026-08-31 – 2026-09-06 · Ett\n/);
  const inbox = await run("--format", "text", "--pretty", "get-messages");
  assert.match(inbox.out, /^Inbox \(1 unread\)\n/, "--pretty is ignored for text");
});

test("--format text follows SCHOOLSOFT_LANG / the locale", async () => {
  const { run } = harness({ env: { LANG: "sv_SE.UTF-8" } });
  await run("login");
  const r = await run("--format", "text", "get-schedule", "--week", "36");
  assert.match(r.out, /^Vecka 36 · Ett\n\nmån 2026-08-31/);
  const en = harness({ env: { LANG: "sv_SE.UTF-8", SCHOOLSOFT_LANG: "en" } });
  await en.run("login");
  assert.match((await en.run("--format", "text", "get-schedule")).out, /^Week /);
});

test("escapes only on a colour-capable TTY; COLUMNS and the TTY width limit lines", async () => {
  const portal = { ...fakePortal, getInbox: async () => INBOX.messages } as unknown as Portal;
  const cases: [Partial<CliDeps>, boolean][] = [
    [{ isTTY: true }, true],
    [{ isTTY: true, env: { NO_COLOR: "1" } }, false],
    [{ isTTY: false }, false],
    [{}, false],
  ];
  for (const [deps, escapes] of cases) {
    const { run } = harness({ portal, ...deps });
    await run("login");
    const r = await run("--format", "text", "get-messages");
    assert.equal(r.out.includes("\u001b["), escapes, JSON.stringify(deps));
    assert.ok(!r.out.includes("\u001b[31m"), "portal escapes never pass");
  }
  const tty = harness({ portal, isTTY: true, columns: 44, env: { NO_COLOR: "1" } });
  await tty.run("login");
  const narrow = (await tty.run("--format", "text", "get-messages")).out.split("\n");
  assert.equal(narrow[3], "*+  7   2026-09-03 16:45  Åsa Lärare   Utfl…");
  const env = harness({ portal, env: { COLUMNS: "40" } });
  await env.run("login");
  for (const line of (await env.run("--format", "text", "get-messages")).out.split("\n"))
    assert.ok([...line].length <= 40, line);
});

test("untyped commands fall back to pretty JSON with one localized note on stderr", async () => {
  const { run, configDir } = harness();
  await run("login");
  const news = await run("--format", "text", "get-news");
  assert.equal(news.code, EXIT.OK);
  assert.equal(news.err, "Text view is not available for get-news yet; showing JSON.");
  assert.deepEqual(JSON.parse(news.out), JSON.parse((await run("get-news")).out));
  assert.equal(news.out, JSON.stringify(JSON.parse(news.out), null, 2));
  const sv = harness({ env: { SCHOOLSOFT_LANG: "sv" } });
  await sv.run("login");
  assert.equal(
    (await sv.run("get-news", "--format", "text")).err,
    "Textvy finns inte för get-news än; visar JSON.",
  );
  const conf = await run(
    "--config-dir",
    configDir,
    "--school",
    "testskola",
    "--format",
    "text",
    "configure",
  );
  assert.equal(conf.code, EXIT.OK, conf.err);
  assert.equal(conf.err, "Text view is not available for configure yet; showing JSON.");
  assert.equal(JSON.parse(conf.out).status, "configured");
});

test("errors keep their two lines and exit code whatever the format", async () => {
  const { run } = harness();
  const asJson = await run("get-schedule");
  const asText = await run("--format", "text", "get-schedule");
  assert.equal(asText.code, EXIT.NOT_AUTHENTICATED);
  assert.deepEqual(asText, asJson);
  assert.equal(asText.err.split("\n").length, 2);
  assert.equal(asText.out, "");
});

test("--format with another value is an input error before the command runs", async () => {
  const { run, h } = harness({ env: { SCHOOLSOFT_LANG: "sv" } });
  const r = await run("--format", "xml", "login");
  assert.equal(r.code, EXIT.INPUT);
  assert.equal(r.out, "");
  const lines = r.err.split("\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0], /--format must be one of json, text, got "xml"/);
  assert.match(lines[1], /^Nästa steg: /);
  assert.equal(h.strategy.loginCalls, 0, "the command did not run");
  assert.equal((await run("get-news", "--format", "TEXT")).code, EXIT.INPUT, "case-sensitive");
});
