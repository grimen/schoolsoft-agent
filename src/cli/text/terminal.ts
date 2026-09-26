/**
 * What a terminal needs from text: how many columns a string takes, how to
 * cut it to fit without splitting a character, how to keep portal text from
 * steering the terminal, and whether colour and a width limit apply. Pure
 * functions over injected values; no process access here.
 */

const GRAPHEMES = new Intl.Segmenter("en", { granularity: "grapheme" });

/** East Asian wide and fullwidth ranges, plus emoji shown as pictures: two columns each. */
const WIDE =
  /^(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}️|[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦])/u;

const ELLIPSIS = "…";

// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

function graphemes(text: string): string[] {
  return Array.from(GRAPHEMES.segment(text), (s) => s.segment);
}

function graphemeWidth(g: string): number {
  return WIDE.test(g) ? 2 : 1;
}

/** Columns a string occupies: one per grapheme cluster, two for wide ones. */
export function displayWidth(text: string): number {
  let width = 0;
  for (const g of graphemes(text)) width += graphemeWidth(g);
  return width;
}

/** Cut to at most `width` columns, ending in an ellipsis when anything was cut. */
export function fit(text: string, width: number): string {
  if (displayWidth(text) <= width) return text;
  let out = "";
  let used = 0;
  for (const g of graphemes(text)) {
    const w = graphemeWidth(g);
    if (used + w > width - 1) break;
    out += g;
    used += w;
  }
  return width > 0 ? out + ELLIPSIS : "";
}

/** Pad with spaces on the right to `width` columns (never cuts). */
export function padEnd(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - displayWidth(text)));
}

/**
 * Portal text on one line and without control characters (C0, DEL, C1,
 * including ESC), so a subject cannot move the cursor or change colours.
 */
export function clean(text: string): string {
  return text.replace(/\s+/g, " ").replace(CONTROL, "").trim();
}

export interface TerminalInfo {
  env: Record<string, string | undefined>;
  isTTY?: boolean;
  columns?: number;
}

/** Colour only on a TTY, without NO_COLOR (any non-empty value) and not on a dumb terminal. */
export function colorEnabled(t: TerminalInfo): boolean {
  return t.isTTY === true && !t.env.NO_COLOR && t.env.TERM !== "dumb";
}

const MIN_COLUMNS = 20;

/** COLUMNS when the user set a usable one, else the TTY's width, else no limit. */
export function outputWidth(t: TerminalInfo): number | undefined {
  const fromEnv = Number(t.env.COLUMNS);
  if (Number.isInteger(fromEnv) && fromEnv >= MIN_COLUMNS) return fromEnv;
  if (t.isTTY === true && t.columns !== undefined && t.columns >= MIN_COLUMNS) return t.columns;
  return undefined;
}

/** Bold on and off (SGR 1 / 22); the only style the views use. */
export function bold(text: string): string {
  return `\u001b[1m${text}\u001b[22m`;
}
