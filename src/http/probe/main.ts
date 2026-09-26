/**
 * `host-probe http|stdio`: starts the probe (never the connector, never by default).
 * The process entry is cli.ts; this is everything it does, with its I/O injected.
 */
import type { Readable, Writable } from "node:stream";
import { InputError } from "../../core/index.js";
import { createProbeApp } from "./app.js";
import { probeHttpConfig, probeLogPath } from "./config.js";
import { fileLog } from "./log.js";
import { startStdioProbe } from "./stdio.js";
import { PROBE_SERVER_NAME } from "./tools.js";

export interface ProbeIo {
  /** Human-facing lines (stderr): stdout belongs to the MCP protocol in stdio mode. */
  say: (line: string) => void;
  input?: Readable;
  output?: Writable;
}

export async function runProbe(
  argv: readonly string[],
  env: Record<string, string | undefined>,
  io: ProbeIo,
): Promise<{ close: () => Promise<void> }> {
  const mode = argv[0];
  const logPath = probeLogPath(env);
  if (mode === "stdio") {
    const log = fileLog(logPath, { surface: "stdio", echo: io.say });
    log.record({ event: "started", mode });
    const probe = await startStdioProbe({ log, input: io.input, output: io.output });
    io.say(`${PROBE_SERVER_NAME} (stdio): fake tools only, never SchoolSoft. Log: ${logPath}`);
    return { close: probe.close };
  }
  if (mode !== "http") throw new InputError("Usage: host-probe http | host-probe stdio");
  const config = probeHttpConfig(env);
  const log = fileLog(logPath, { surface: "http", echo: io.say });
  const probe = createProbeApp({ ...config, log });
  // Loopback only: a tunnel on this machine carries the public address to it.
  const server = probe.app.listen(config.port, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  log.record({ event: "started", mode });
  io.say(
    [
      `${PROBE_SERVER_NAME} (http): fake tools only, never SchoolSoft.`,
      `Listening on http://127.0.0.1:${config.port}; public address ${config.publicUrl}/mcp`,
      config.generatedPassword
        ? `Probe password for this run (PROBE_ADMIN_PASSWORD was not set): ${config.adminPassword}`
        : "Probe password: the PROBE_ADMIN_PASSWORD you set.",
      `Log: ${logPath}`,
    ].join("\n"),
  );
  return {
    close: async () => {
      await probe.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
