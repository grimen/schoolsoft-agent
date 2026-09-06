#!/usr/bin/env node
/**
 * schoolsoft-agent — CLI entry point (also what the skill's scripts call).
 */
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { runCli } from "./program.js";
import { loadContext } from "../shared/bootstrap.js";
import { PACKAGE_VERSION } from "../shared/version.js";

async function main(): Promise<void> {
  const rl = process.stdin.isTTY
    ? createInterface({ input: process.stdin, output: process.stderr })
    : null;
  const code = await runCli(process.argv.slice(2), {
    getContext: (overrides) =>
      loadContext({ env: process.env, home: homedir(), platform: process.platform, overrides })(),
    stdout: (s) => process.stdout.write(s + "\n"),
    stderr: (s) => process.stderr.write(s + "\n"),
    env: process.env,
    home: homedir(),
    platform: process.platform,
    version: PACKAGE_VERSION,
    prompt: rl ? (q) => rl.question(q) : undefined,
    detach: (argv) => {
      const child = spawn(process.execPath, [process.argv[1], ...argv], {
        detached: true,
        stdio: "ignore",
        env: process.env,
      });
      child.unref();
      return child.pid ?? 0;
    },
  });
  rl?.close();
  process.exitCode = code;
}

main().catch((e) => {
  process.stderr.write(`Fatal: ${e instanceof Error ? e.message : e}\n`);
  process.exitCode = 1;
});
