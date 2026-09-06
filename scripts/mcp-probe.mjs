// Spawns an MCP stdio server command, performs initialize + tools/list and
// prints the tool count (exit 1 on anything else). Portable replacement for
// `timeout ... | node -e` pipelines in the smoke scripts.
//   node scripts/mcp-probe.mjs <expected-count> <command> [args...]
import { spawn } from "node:child_process";

const [expected, command, ...args] = process.argv.slice(2);
if (!expected || !command) {
  console.error("usage: mcp-probe.mjs <expected-count> <command> [args...]");
  process.exit(2);
}
const child = spawn(command, args, { stdio: ["pipe", "pipe", "inherit"], env: process.env });
const timer = setTimeout(() => {
  console.error("mcp-probe: timed out");
  child.kill();
  process.exit(1);
}, 20_000);
let out = "";
child.stdout.on("data", (c) => {
  out += c;
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.id === 2) {
      const n = msg.result?.tools?.length;
      clearTimeout(timer);
      child.kill();
      if (String(n) !== expected) {
        console.error(`mcp-probe: expected ${expected} tools, got ${n}`);
        process.exit(1);
      }
      console.log(`mcp-probe: ${command} lists ${n} tools`);
      process.exit(0);
    }
  }
});
child.on("exit", (code) => {
  clearTimeout(timer);
  console.error(`mcp-probe: server exited early (code ${code})`);
  process.exit(1);
});
const send = (o) => child.stdin.write(JSON.stringify(o) + "\n");
send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "mcp-probe", version: "0" },
  },
});
send({ jsonrpc: "2.0", method: "notifications/initialized" });
send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
