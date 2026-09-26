/**
 * Aligned columns for the list views. One column may be flexible: when the
 * rows are wider than the terminal it shrinks first (down to a minimum),
 * so the school name or subject gives way before ids and dates do. Cells
 * are measured in display columns, so å, ä and ö line up.
 */
import { displayWidth, fit, padEnd } from "./terminal.js";

export interface TableOptions {
  /** Index of the column that shrinks when space runs out. */
  flex: number;
  /** Columns available, or undefined for no limit. */
  width?: number;
  /** Spaces between columns. */
  gap?: number;
}

const MIN_FLEX = 8;

/** Rows of cells (a header first, all rows the same length) as aligned lines; trailing spaces trimmed. */
export function table(rows: string[][], { flex, width, gap = 2 }: TableOptions): string[] {
  const count = rows[0].length;
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => displayWidth(r[i]))));
  if (width !== undefined) {
    const total = widths.reduce((a, b) => a + b, 0) + gap * (count - 1);
    if (total > width) {
      widths[flex] = Math.max(Math.min(MIN_FLEX, widths[flex]), widths[flex] - (total - width));
    }
  }
  return rows.map((r) =>
    widths
      .map((w, i) => padEnd(fit(r[i], w), w))
      .join(" ".repeat(gap))
      .trimEnd(),
  );
}
