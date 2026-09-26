#!/usr/bin/env node
/** Process entry for `make host-probe` / `make host-probe-stdio`; exercised by test/functional/host-probe-spawn.test.ts. */
import { runProbe } from "./main.js";
const say = (line: string) => void process.stderr.write(line + "\n");
try {
  const { close } = await runProbe(process.argv.slice(2), process.env, { say });
  const stop = () => void close().then(() => process.exit(0));
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  if (process.argv[2] === "stdio") process.stdin.once("end", stop);
} catch (error) {
  say(`Host probe could not start: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
