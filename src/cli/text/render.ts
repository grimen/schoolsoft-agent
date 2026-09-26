/**
 * The contract between the CLI and a text view. A renderer is a pure
 * function from an operation's validated result to lines; it knows the
 * language, the width and today's date, never the terminal. Emphasis is a
 * property of a line, turned into escape codes here only when colour is on,
 * after the line has been cut to the width, so escapes never count as
 * columns and never get cut in half.
 */
import type { Lang } from "../../core/index.js";
import { bold, clean, fit } from "./terminal.js";

/** A printed line: plain text, or text to emphasise (unread, today). */
export type Line = string | { text: string; strong: true };

export interface RenderContext {
  lang: Lang;
  /** Columns available, or undefined for no limit (a pipe or a file). */
  width?: number;
  /** Today's date in Stockholm, YYYY-MM-DD. */
  today: string;
}

export type TextRenderer = (data: unknown, ctx: RenderContext) => Line[];

/** Declare a renderer against its operation's result type. */
export function renderer<T>(render: (data: T, ctx: RenderContext) => Line[]): TextRenderer {
  return render as TextRenderer;
}

export const strong = (text: string): Line => ({ text, strong: true });

/** Lines to one block of output: each cut to the width, emphasis in bold when colour is on. */
export function toText(lines: Line[], width: number | undefined, color: boolean): string {
  return lines
    .map((line) => {
      const text = typeof line === "string" ? line : line.text;
      const cut = width === undefined ? text : fit(text, width);
      return typeof line !== "string" && color ? bold(cut) : cut;
    })
    .join("\n");
}

/** Portal text for a cell: cleaned, or an en dash when missing or blank. */
export function cell(value: string | null): string {
  return (value === null ? "" : clean(value)) || "–";
}
