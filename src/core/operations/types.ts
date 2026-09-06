/**
 * An Operation is the single definition of a capability. The MCP server,
 * the CLI and the generated docs are all derived from the registry of
 * operations, so a capability is written exactly once.
 */
import type { z } from "zod";
import type { SessionManager } from "../session/session-manager.js";
import type { Portal } from "../portal/types.js";
import type { Config } from "../config.js";

export interface OperationAnnotations {
  /** Does not modify anything at SchoolSoft. */
  readOnly: boolean;
  /** May irreversibly change data at SchoolSoft (future write ops). */
  destructive: boolean;
  /** Repeating the call with the same args has no additional effect. */
  idempotent: boolean;
  /** Needs an authenticated session (false: find_school, auth_status). */
  requiresAuth: boolean;
}

export interface OperationContext {
  manager: SessionManager;
  portal: Portal;
  config: Config;
  /** Diagnostic output (stderr for stdio surfaces). */
  log: (message: string) => void;
}

export interface Operation<I extends z.ZodRawShape = z.ZodRawShape, O = unknown> {
  /** snake_case, surface-neutral, e.g. "get_schedule". */
  name: string;
  title: string;
  /** Includes a "Use when:" line so agents know when to reach for it. */
  description: string;
  /** Zod raw shape; MCP inputSchema and CLI flags derive from it. */
  input: I;
  annotations: OperationAnnotations;
  run(ctx: OperationContext, args: z.infer<z.ZodObject<I>>): Promise<O>;
}

export function defineOperation<I extends z.ZodRawShape, O>(op: Operation<I, O>): Operation<I, O> {
  return op;
}

export const READ_ONLY: OperationAnnotations = {
  readOnly: true,
  destructive: false,
  idempotent: true,
  requiresAuth: true,
};
