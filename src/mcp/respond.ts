/** Shared response formatting for all tools. */
import { CHARACTER_LIMIT, describeError, type Lang } from "../core/index.js";

export interface ToolResult {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  [key: string]: unknown;
}

/**
 * `typed`: the tool declares an outputSchema, and the protocol then requires
 * structured content on every successful result, so only the text copy is
 * truncated. Untyped tools drop the structured copy of an oversized result.
 */
export function ok(data: Record<string, unknown>, typed = false): ToolResult {
  let text = JSON.stringify(data, null, 2);
  if (text.length > CHARACTER_LIMIT) {
    text =
      text.slice(0, CHARACTER_LIMIT) +
      `\n… [truncated at ${CHARACTER_LIMIT} chars — use narrower filters]`;
    return typed
      ? { content: [{ type: "text", text }], structuredContent: data }
      : { content: [{ type: "text", text }] };
  }
  return {
    content: [{ type: "text", text }],
    structuredContent: data,
  };
}

/**
 * One line for the problem, one for what the agent should do next; kind and
 * retryability as structured content. `typed`: the tool declares an
 * outputSchema, and the SDK's client validates structured content against it
 * even on error results, so the error object would turn a clean tool error
 * into a protocol failure; those results carry the two lines only.
 */
export function fail(error: unknown, lang: Lang = "en", typed = false): ToolResult {
  const d = describeError(error, lang, "mcp");
  const text = d.hint ? `Error: ${d.message}\nNext: ${d.hint}` : `Error: ${d.message}`;
  if (typed) return { content: [{ type: "text", text }], isError: true };
  return {
    content: [{ type: "text", text }],
    structuredContent: {
      error: { kind: d.kind, message: d.message, hint: d.hint, retryable: d.retryable },
    },
    isError: true,
  };
}
