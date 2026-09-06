/**
 * MCP surface: one tool per operation in the registry. Tool names keep the
 * `schoolsoft_` prefix so hosts and E2E tests stay stable.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { operations, type Lang, type OperationContext } from "../core/index.js";
import { ok, fail } from "./respond.js";

export const TOOL_PREFIX = "schoolsoft_";

export interface McpServerOptions {
  /** Resolves the operation context; may throw NotConfiguredError. */
  getContext: () => Promise<OperationContext> | OperationContext;
  version?: string;
  /** Language for error text; default English. */
  lang?: Lang;
}

export function createMcpServer(options: McpServerOptions): McpServer {
  const server = new McpServer({ name: "schoolsoft-agent", version: options.version ?? "0.0.0" });
  for (const op of operations) {
    server.registerTool(
      TOOL_PREFIX + op.name,
      {
        title: op.title,
        description: op.description,
        inputSchema: op.input,
        annotations: {
          readOnlyHint: op.annotations.readOnly,
          destructiveHint: op.annotations.destructive,
          idempotentHint: op.annotations.idempotent,
          openWorldHint: true,
        },
      },
      async (args: Record<string, unknown>) => {
        try {
          const ctx = await options.getContext();
          const result = await op.run(ctx, args as never);
          return ok(result as Record<string, unknown>);
        } catch (e) {
          return fail(e, options.lang);
        }
      },
    );
  }
  return server;
}
