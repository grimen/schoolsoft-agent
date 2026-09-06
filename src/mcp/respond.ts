/** Shared response formatting for all tools. */
import { CHARACTER_LIMIT, describeError, type Lang } from "../core/index.js";

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

/** One line for the problem, one for what the agent should do next; kind and retryability as structured content. */
export function fail(error: unknown, lang: Lang = "en"): ToolResult {
  const d = describeError(error, lang, "mcp");
  const text = d.hint ? `Error: ${d.message}\nNext: ${d.hint}` : `Error: ${d.message}`;
  return {
    content: [{ type: "text", text }],
    structuredContent: {
      error: { kind: d.kind, message: d.message, hint: d.hint, retryable: d.retryable },
    },
    isError: true,
  };
}
