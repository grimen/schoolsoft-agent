/**
 * The probe's process entry (src/http/probe/cli.ts, excluded from the coverage gate for
 * this test) started the way `make host-probe-stdio` and a local host start it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TSX = "./node_modules/.bin/tsx";
const ENTRY = "src/http/probe/cli.ts";

test("stdio: a host initialises, lists the probe tools and the process ends with stdin", async () => {
  const dir = mkdtempSync(join(tmpdir(), "probe-spawn-"));
  const child = spawn(TSX, [ENTRY, "stdio"], {
    env: { ...process.env, PROBE_LOG: join(dir, "e.jsonl") },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let out = "";
  let err = "";
  child.stdout.on("data", (chunk: Buffer) => (out += chunk));
  child.stderr.on("data", (chunk: Buffer) => (err += chunk));
  const send = (message: object) => child.stdin.write(JSON.stringify(message) + "\n");
  send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "spawn", version: "1" },
    },
  });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const deadline = Date.now() + 20_000;
  while (!out.includes('"id":2') && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 20));
  child.stdin.end();
  const [code] = (await once(child, "exit")) as [number];
  assert.equal(code, 0, err);
  assert.match(out, /probe_confirmed_write/);
  assert.match(err, /schoolsoft-agent probe \(stdio\)/);
  assert.match(readFileSync(join(dir, "e.jsonl"), "utf8"), /"client":"spawn"/);
});

test("a bad setting stops the process with a reason and exit 1", async () => {
  const child = spawn(TSX, [ENTRY, "http"], {
    env: { ...process.env, PROBE_PUBLIC_URL: "http://probe.example" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let err = "";
  child.stderr.on("data", (chunk: Buffer) => (err += chunk));
  const [code] = (await once(child, "exit")) as [number];
  assert.equal(code, 1);
  assert.match(err, /Host probe could not start: .*PROBE_PUBLIC_URL/);
});
