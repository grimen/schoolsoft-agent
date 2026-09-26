/**
 * The probe over stdio, for hosts that start local servers (Claude Desktop, Claude Code).
 * No OAuth, so no step-up tools. The URL-elicitation page is served on a loopback
 * listener that starts on first use.
 */
import { randomBytes } from "node:crypto";
import type { Server } from "node:http";
import type { Readable, Writable } from "node:stream";
import express from "express";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { ProbeLog } from "./log.js";
import { ProbeConfirmations } from "./confirmations.js";
import { UrlPages, createProbeServer, tapMessages } from "./tools.js";
import { harden, logRequests, mountUrlPages } from "./web.js";

export async function startStdioProbe(options: {
  log: ProbeLog;
  input?: Readable;
  output?: Writable;
  now?: () => number;
  elicitTimeoutMs?: number;
}) {
  const { log } = options;
  let origin = "";
  let listener: Server | undefined;
  let listening: Promise<string> | undefined;
  const pageApp = express();
  harden(pageApp, () => origin);
  logRequests(pageApp, log);
  pageApp.use(express.urlencoded({ extended: false, limit: "16kb" }));
  const base = () =>
    (listening ??= new Promise<string>((resolve) => {
      listener = pageApp.listen(0, "127.0.0.1", () => {
        const address = listener!.address() as { port: number };
        origin = `http://127.0.0.1:${address.port}`;
        resolve(origin);
      });
    }));
  const pages = new UrlPages(base, { now: options.now });
  mountUrlPages(pageApp, { pages, log, origin: () => origin });
  const session = randomBytes(4).toString("hex");
  const server = createProbeServer({
    surface: "stdio",
    log,
    session,
    confirmations: new ProbeConfirmations({ now: options.now }),
    pages,
    now: options.now,
    elicitTimeoutMs: options.elicitTimeoutMs,
  });
  const transport = new StdioServerTransport(options.input, options.output);
  await server.connect(transport);
  tapMessages(transport, log, session);
  return {
    /** The loopback page's origin, once a URL elicitation started it. */
    pageOrigin: () => origin,
    close: async () => {
      await server.close();
      listener?.closeAllConnections();
      await new Promise<void>((resolve) =>
        listener ? listener.close(() => resolve()) : resolve(),
      );
    },
  };
}
