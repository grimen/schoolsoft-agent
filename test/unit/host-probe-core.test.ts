/** The host probe's event log and its #59-style confirmation store. Fake data only. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileLog, memoryLog, safePath } from "../../src/http/probe/log.js";
import { ProbeConfirmations, canonical } from "../../src/http/probe/confirmations.js";

test("the file log appends one JSON line per event, private to the owner, and echoes a summary", () => {
  const dir = mkdtempSync(join(tmpdir(), "probe-log-"));
  const path = join(dir, "nested", "events.jsonl");
  const lines: string[] = [];
  const log = fileLog(path, {
    surface: "http",
    now: () => Date.UTC(2026, 8, 26, 12),
    echo: (line) => lines.push(line),
  });
  log.record({ event: "tool_call", tool: "probe_read", args: ["a"] });
  log.record({ event: "http", method: "GET", path: "/owner", status: 200 });
  const written = readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  assert.deepEqual(written[0], {
    at: "2026-09-26T12:00:00.000Z",
    surface: "http",
    event: "tool_call",
    tool: "probe_read",
    args: ["a"],
  });
  assert.equal(written.length, 2);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(statSync(join(dir, "nested")).mode & 0o777, 0o700);
  assert.deepEqual(lines, [
    'host-probe tool_call {"tool":"probe_read","args":["a"]}',
    'host-probe http {"method":"GET","path":"/owner","status":200}',
  ]);
  assert.equal(log.recent().length, 2);
  assert.equal(log.recent()[1].event, "http");
});

test("the file log keeps only the latest events in memory and echoes to stderr by default", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "probe-log-"));
  const writes: string[] = [];
  t.mock.method(process.stderr, "write", (chunk: string) => {
    writes.push(chunk);
    return true;
  });
  const log = fileLog(join(dir, "e.jsonl"), { surface: "stdio", keep: 2 });
  for (const n of [1, 2, 3]) log.record({ event: "rpc", method: `m${n}` });
  t.mock.restoreAll();
  assert.deepEqual(
    log.recent().map((e) => e.method),
    ["m2", "m3"],
  );
  assert.equal(writes.length, 3);
  assert.match(writes[0], /^host-probe rpc \{"method":"m1"\}\n$/);
  assert.match(log.recent()[0].at, /^\d{4}-\d{2}-\d{2}T/);
});

test("the memory log records the same shape without touching disk", () => {
  const log = memoryLog("stdio", () => 0);
  log.record({ event: "started", mode: "stdio" });
  assert.deepEqual(log.events, [
    { at: "1970-01-01T00:00:00.000Z", surface: "stdio", event: "started", mode: "stdio" },
  ]);
  assert.deepEqual(log.recent(), log.events);
  assert.equal(memoryLog("http").recent().length, 0);
});

test("logged paths carry no query string and no ids", () => {
  assert.equal(safePath("/owner/consent?request=secret"), "/owner/consent");
  assert.equal(safePath("/probe/elicit/abcDEF_-123"), "/probe/elicit/:id");
  assert.equal(safePath("/probe/elicit/abc/done?x=1"), "/probe/elicit/:id/done");
  assert.equal(
    safePath("/.well-known/oauth-authorization-server"),
    "/.well-known/oauth-authorization-server",
  );
});

test("canonical JSON sorts keys at every depth so equal intents hash equally", () => {
  assert.equal(
    canonical({ b: 1, a: { d: [2, { f: 1, e: 0 }], c: null } }),
    canonical({ a: { c: null, d: [2, { e: 0, f: 1 }] }, b: 1 }),
  );
  assert.equal(canonical({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.equal(canonical("x"), '"x"');
});

function store(now = { t: 1_000_000 }) {
  let n = 0;
  return {
    now,
    confirmations: new ProbeConfirmations({
      key: Buffer.alloc(32, 7),
      now: () => now.t,
      random: (size) => Buffer.alloc(size, ++n),
      max: 3,
    }),
  };
}

test("a preview returns an opaque single-use token bound to the intent and the binding", () => {
  const { confirmations, now } = store();
  const intent = { tool: "probe_confirmed_write", date: "2026-09-28", part: "whole_day" };
  const preview = confirmations.preview("grant:a", intent);
  assert.match(preview.confirmation, /^wct_[A-Za-z0-9_-]{43}$/);
  assert.match(preview.writeId, /^[0-9a-f-]{36}$/);
  assert.equal(preview.expiresAt, 1_000_000 + 600_000);
  assert.ok(
    !JSON.stringify(confirmations).includes(preview.confirmation),
    "only a keyed hash is kept",
  );
  now.t += 5_000;
  const sent = confirmations.confirm("grant:a", { ...intent }, preview.confirmation);
  assert.deepEqual(sent, { outcome: "sent", writeId: preview.writeId, secondsSincePreview: 5 });
  // The same token, arguments and binding again: the recorded outcome, nothing sent twice.
  assert.deepEqual(confirmations.confirm("grant:a", intent, preview.confirmation), {
    outcome: "replayed",
    writeId: preview.writeId,
    secondsSincePreview: 5,
  });
  // From another binding: refused, even though the token is genuine.
  assert.deepEqual(confirmations.confirm("grant:b", intent, preview.confirmation), {
    outcome: "invalid",
  });
});

test("changed input voids the token; unknown and expired tokens are refused", () => {
  const { confirmations, now } = store();
  const intent = { date: "2026-09-28" };
  const first = confirmations.preview("local", intent);
  assert.deepEqual(confirmations.confirm("local", { date: "2026-09-29" }, first.confirmation), {
    outcome: "input_changed",
    writeId: first.writeId,
  });
  assert.deepEqual(confirmations.confirm("local", intent, first.confirmation), {
    outcome: "invalid",
  });
  assert.deepEqual(confirmations.confirm("local", intent, "wct_unknown"), { outcome: "invalid" });
  const second = confirmations.preview("local", intent);
  now.t += 600_000;
  assert.deepEqual(confirmations.confirm("local", intent, second.confirmation), {
    outcome: "expired",
    writeId: second.writeId,
  });
  assert.deepEqual(confirmations.confirm("local", intent, second.confirmation), {
    outcome: "invalid",
  });
});

test("a spent token presented with other arguments is also voided", () => {
  const { confirmations } = store();
  const preview = confirmations.preview("local", { date: "a" });
  assert.equal(confirmations.confirm("local", { date: "a" }, preview.confirmation).outcome, "sent");
  assert.equal(
    confirmations.confirm("local", { date: "b" }, preview.confirmation).outcome,
    "input_changed",
  );
  assert.equal(
    confirmations.confirm("local", { date: "a" }, preview.confirmation).outcome,
    "invalid",
  );
});

test("the store is bounded: the oldest record makes room and expired ones are pruned", () => {
  const { confirmations, now } = store();
  const tokens = [1, 2, 3, 4].map((n) => confirmations.preview("local", { n }).confirmation);
  assert.equal(confirmations.size(), 3);
  assert.equal(confirmations.confirm("local", { n: 1 }, tokens[0]).outcome, "invalid");
  assert.equal(confirmations.confirm("local", { n: 4 }, tokens[3]).outcome, "sent");
  now.t += 600_001;
  confirmations.preview("local", { n: 5 });
  assert.equal(confirmations.size(), 1);
});

test("defaults: a random key and the real clock", () => {
  const confirmations = new ProbeConfirmations();
  const preview = confirmations.preview("local", {});
  assert.ok(preview.expiresAt > Date.now());
  assert.equal(confirmations.confirm("local", {}, preview.confirmation).outcome, "sent");
});
