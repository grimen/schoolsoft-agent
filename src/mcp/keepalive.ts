/**
 * Starts the opt-in session keepalive for the stdio MCP server, the one
 * local surface that lives long enough for it to matter (the CLI runs one
 * command and exits, so it never calls this). A server that is not
 * configured yet still starts: there is simply nothing to keep alive.
 */
import {
  AgentError,
  createKeepalive,
  type KeepaliveDeps,
  type KeepaliveScheduler,
  type OperationContext,
} from "../core/index.js";

export function startMcpKeepalive(
  getContext: () => OperationContext,
  deps: KeepaliveDeps = {},
): KeepaliveScheduler | null {
  let ctx: OperationContext;
  try {
    ctx = getContext();
  } catch (e) {
    if (e instanceof AgentError) return null; // not configured; every tool says so already
    throw e;
  }
  const scheduler = createKeepalive(ctx.config, ctx.manager, { log: ctx.log, ...deps });
  scheduler?.start();
  return scheduler;
}
