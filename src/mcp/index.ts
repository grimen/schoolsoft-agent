#!/usr/bin/env node
/**
 * schoolsoft-agent-mcp — stdio MCP server entry point.
 *
 * Config comes from SCHOOLSOFT_* env vars and the config file written by
 * `schoolsoft-agent configure`. If nothing is configured the server still
 * starts; every tool then returns an error naming `configure`.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { homedir } from "node:os";
import { createMcpServer } from "./server.js";
import { loadContext } from "../shared/bootstrap.js";
import { detectLang } from "../core/index.js";
import { PACKAGE_VERSION } from "../shared/version.js";

async function main(): Promise<void> {
  const context = loadContext({ env: process.env, home: homedir(), platform: process.platform });
  const server = createMcpServer({
    getContext: () => context(),
    version: PACKAGE_VERSION,
    lang: detectLang(process.env),
  });
  await server.connect(new StdioServerTransport());
  console.error("schoolsoft-agent-mcp running on stdio");
}

main().catch((error) => {
  console.error("Fatal:", error);
  process.exit(1);
});
