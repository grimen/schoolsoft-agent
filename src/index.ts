#!/usr/bin/env node
/**
 * schoolsoft-mcp-server — unofficial MCP server for SchoolSoft.
 *
 * Local stdio server. Auth is interactive-first (BankID in the user's own
 * browser) with encrypted session persistence; see src/auth/browser-flow.ts
 * and CLAUDE.md for the full strategy and open questions.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAuthTools } from "./tools/auth.js";
import { registerReadTools } from "./tools/read.js";

const server = new McpServer({
  name: "schoolsoft-mcp-server",
  version: "0.1.0",
});

registerAuthTools(server);
registerReadTools(server);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("schoolsoft-mcp-server running on stdio");
}

main().catch((error) => {
  console.error("Fatal:", error);
  process.exit(1);
});
