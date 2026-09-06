/** Shared response formatting for all tools. */
import { CHARACTER_LIMIT } from "../constants.js";
import { NotAuthenticatedError } from "./session-manager.js";

export interface ToolResult {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  [key: string]: unknown;
}

export function ok(data: Record<string, unknown>): ToolResult {
  let text = JSON.stringify(data, null, 2);
  if (text.length > CHARACTER_LIMIT) {
    text =
      text.slice(0, CHARACTER_LIMIT) +
      `\n… [truncated at ${CHARACTER_LIMIT} chars — use narrower filters]`;
    return { content: [{ type: "text", text }] };
  }
  return {
    content: [{ type: "text", text }],
    structuredContent: data,
  };
}

export function fail(error: unknown): ToolResult {
  const message =
    error instanceof Error ? error.message : String(error ?? "Unknown error");
  const hint =
    error instanceof NotAuthenticatedError
      ? ""
      : "\nIf this looks like an auth problem, try schoolsoft_auth_status.";
  return {
    content: [{ type: "text", text: `Error: ${message}${hint}` }],
    isError: true,
  };
}

/** Wrap a handler with uniform error handling. */
export function guarded<A>(
  fn: (args: A) => Promise<ToolResult>,
): (args: A) => Promise<ToolResult> {
  return async (args: A) => {
    try {
      return await fn(args);
    } catch (e) {
      return fail(e);
    }
  };
}
