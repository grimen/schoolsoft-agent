/** The probe's settings, its two start modes and the stdio mode's loopback URL page. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { DEFAULT_LOG, probeHttpConfig, probeLogPath } from "../../src/http/probe/config.js";
import { runProbe } from "../../src/http/probe/main.js";

const PASSWORD = "synthetic-probe-password-0123456789-abcdef";

test("probe settings: an HTTPS origin (or loopback http), a strong password or a generated one", () => {
  const config = probeHttpConfig({ PROBE_PUBLIC_URL: "https://probe.example/" }, () => "made-up");
  assert.deepEqual(config, {
    publicUrl: "https://probe.example",
    port: 8787,
    proxyHops: 0,
    adminPassword: "made-up",
    generatedPassword: true,
  });
  assert.equal(
    probeHttpConfig({ PROBE_PUBLIC_URL: "https://probe.example" }).adminPassword.length,
    43,
  );
  const set = probeHttpConfig({
    PROBE_PUBLIC_URL: "http://localhost:9000",
    PROBE_ADMIN_PASSWORD: PASSWORD,
    PROBE_PORT: "9000",
    PROBE_PROXY_HOPS: "1",
  });
  assert.deepEqual(
    [set.publicUrl, set.port, set.proxyHops, set.generatedPassword],
    ["http://localhost:9000", 9000, 1, false],
  );
  assert.equal(
    probeHttpConfig({ PROBE_PUBLIC_URL: "http://127.0.0.1:1" }).publicUrl,
    "http://127.0.0.1:1",
  );
  for (const url of [
    undefined,
    "nope",
    "http://probe.example",
    "https://a:b@probe.example",
    "https://probe.example/?q",
    "https://probe.example/#x",
    "https://probe.example/mcp",
  ])
    assert.throws(() => probeHttpConfig({ PROBE_PUBLIC_URL: url }), /PROBE_PUBLIC_URL/);
  const base = { PROBE_PUBLIC_URL: "https://probe.example" };
  for (const password of ["short", "a".repeat(40), "é".repeat(600) + "abcdefgh"])
    assert.throws(
      () => probeHttpConfig({ ...base, PROBE_ADMIN_PASSWORD: password }),
      /PROBE_ADMIN_PASSWORD/,
    );
  for (const port of ["0", "70000", "x"])
    assert.throws(() => probeHttpConfig({ ...base, PROBE_PORT: port }), /PROBE_PORT/);
  for (const hops of ["3", "-1", "x"])
    assert.throws(() => probeHttpConfig({ ...base, PROBE_PROXY_HOPS: hops }), /PROBE_PROXY_HOPS/);
  assert.match(DEFAULT_LOG, /\/\.host-probe\/events\.jsonl$/);
  assert.equal(probeLogPath({}), DEFAULT_LOG);
  assert.equal(probeLogPath({ PROBE_LOG: "/tmp/x.jsonl" }), "/tmp/x.jsonl");
});

test("an unknown mode is refused with the usage", async () => {
  await assert.rejects(runProbe(["serve"], {}, { say: () => {} }), /Usage: host-probe http/);
  await assert.rejects(runProbe([], {}, { say: () => {} }), /Usage/);
});

test("http mode listens on loopback, says where, and prints a generated password once", async () => {
  const dir = mkdtempSync(join(tmpdir(), "probe-main-"));
  const lines: string[] = [];
  const env = {
    PROBE_PUBLIC_URL: "https://probe.example",
    PROBE_PORT: "0",
    PROBE_LOG: join(dir, "e.jsonl"),
  };
  await assert.rejects(
    runProbe(["http"], { ...env, PROBE_PORT: "x" }, { say: () => {} }),
    /PROBE_PORT/,
  );
  // Port 0 is refused by the settings; take a free one instead.
  const { createServer } = await import("node:net");
  const free = createServer().listen(0, "127.0.0.1");
  await new Promise((resolve) => free.once("listening", resolve));
  const port = (free.address() as { port: number }).port;
  await new Promise<void>((resolve) => free.close(() => resolve()));
  const probe = await runProbe(
    ["http"],
    { ...env, PROBE_PORT: String(port) },
    {
      say: (line) => lines.push(line),
    },
  );
  try {
    const health = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(health.status, 200);
    const banner = lines.find((line) => line.includes("(http)"))!;
    assert.match(banner, /never SchoolSoft/);
    assert.match(banner, /public address https:\/\/probe\.example\/mcp/);
    assert.match(banner, /Probe password for this run/);
    const second = runProbe(
      ["http"],
      {
        ...env,
        PROBE_PORT: String(port),
        PROBE_ADMIN_PASSWORD: PASSWORD,
      },
      { say: () => {} },
    );
    await assert.rejects(second, /EADDRINUSE/);
  } finally {
    await probe.close();
  }
  const logged = readFileSync(join(dir, "e.jsonl"), "utf8");
  assert.match(logged, /"event":"started","mode":"http"/);
  const withPassword = await runProbe(
    ["http"],
    { ...env, PROBE_PORT: String(port), PROBE_ADMIN_PASSWORD: PASSWORD },
    { say: (line) => lines.push(line) },
  );
  await withPassword.close();
  assert.ok(lines.some((line) => line.includes("the PROBE_ADMIN_PASSWORD you set")));
  assert.ok(!lines.some((line) => line.includes(PASSWORD)));
});

/** JSON-RPC over the stdio streams, one line per message. */
function wire(input: PassThrough, output: PassThrough) {
  const inbox: Record<string, unknown>[] = [];
  let buffer = "";
  output.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      inbox.push(JSON.parse(buffer.slice(0, newline)));
      buffer = buffer.slice(newline + 1);
    }
  });
  return {
    send: (message: Record<string, unknown>) =>
      input.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n"),
    next: async (match: (message: Record<string, unknown>) => boolean) => {
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        const index = inbox.findIndex(match);
        if (index >= 0) return inbox.splice(index, 1)[0];
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      throw new Error("no matching message");
    },
  };
}

test("stdio mode: no step-up tools, and a URL elicitation served on a loopback page", async () => {
  const dir = mkdtempSync(join(tmpdir(), "probe-stdio-"));
  const input = new PassThrough();
  const output = new PassThrough();
  const lines: string[] = [];
  const probe = await runProbe(
    ["stdio"],
    { PROBE_LOG: join(dir, "e.jsonl") },
    {
      say: (line) => lines.push(line),
      input,
      output,
    },
  );
  const rpc = wire(input, output);
  try {
    assert.ok(lines.some((line) => line.includes("(stdio)")));
    rpc.send({
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: { elicitation: { url: {} } },
        clientInfo: { name: "stdio-host", version: "1" },
      },
    });
    const init = await rpc.next((m) => m.id === 1);
    assert.equal(
      (init.result as { serverInfo: { name: string } }).serverInfo.name,
      "schoolsoft-agent probe",
    );
    rpc.send({ method: "notifications/initialized" });
    rpc.send({ id: 2, method: "tools/list" });
    const list = await rpc.next((m) => m.id === 2);
    const names = (list.result as { tools: { name: string }[] }).tools.map((tool) => tool.name);
    assert.ok(!names.some((name) => name.startsWith("probe_step_up")));
    assert.equal(names.length, 8);

    rpc.send({ id: 3, method: "tools/call", params: { name: "probe_elicit_url", arguments: {} } });
    const ask = await rpc.next((m) => m.method === "elicitation/create");
    const params = ask.params as { url: string; elicitationId: string };
    const url = new URL(params.url);
    assert.equal(url.hostname, "127.0.0.1");
    rpc.send({ id: ask.id, result: { action: "accept" } });
    const answered = await rpc.next((m) => m.id === 3);
    assert.match(JSON.stringify(answered.result), /answered \\"accept\\"/);

    const shown = await fetch(url);
    assert.equal(shown.status, 200);
    assert.match(await shown.text(), /Nothing here is real/);
    assert.equal(
      (await fetch(url, { method: "POST", headers: { Origin: "https://evil.example" } })).status,
      403,
    );
    const done = await fetch(url, { method: "POST", headers: { Origin: url.origin } });
    assert.equal(done.status, 200);
    const complete = await rpc.next((m) => m.method === "notifications/elicitation/complete");
    assert.deepEqual(complete.params, { elicitationId: params.elicitationId });
    assert.equal((await fetch(url.origin + "/probe/elicit/gone")).status, 404);
    const again = await fetch(url, { method: "POST", headers: { Origin: url.origin } });
    assert.equal(again.status, 404);
    assert.match(await again.text(), /expired/);
  } finally {
    await probe.close();
  }
  const events = readFileSync(join(dir, "e.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { event: string; stage?: string; surface: string });
  assert.ok(events.every((event) => event.surface === "stdio"));
  assert.deepEqual(
    events.filter((e) => e.event === "url_page").map((e) => e.stage),
    ["opened", "completed", "unknown", "unknown"],
  );
});

test("stdio mode closes cleanly when no page was ever served", async () => {
  const dir = mkdtempSync(join(tmpdir(), "probe-stdio-"));
  const probe = await runProbe(
    ["stdio"],
    { PROBE_LOG: join(dir, "e.jsonl") },
    {
      say: () => {},
      input: new PassThrough(),
      output: new PassThrough(),
    },
  );
  await probe.close();
});
