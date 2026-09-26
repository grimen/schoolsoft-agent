/**
 * A small, forgiving HTML tokenizer for the capture probe's redactor. It
 * splits a page into tags, text, comments and raw element bodies and puts
 * it back together; it builds no tree and never runs anything. Good enough
 * for SchoolSoft's server-rendered JSP pages, which is all it is used for:
 * the redactor treats whatever it does not recognise as data and replaces it.
 */

export interface HtmlAttr {
  name: string;
  /** null for a bare attribute (`<input required>`). */
  value: string | null;
}

export type HtmlToken =
  | { kind: "text"; text: string }
  /** Body of a raw-text element (script, style, textarea, title). */
  | { kind: "raw"; parent: string; text: string }
  | { kind: "comment"; text: string }
  | { kind: "doctype"; text: string }
  | { kind: "open"; name: string; attrs: HtmlAttr[]; selfClosing: boolean }
  | { kind: "close"; name: string };

const RAW_ELEMENTS = new Set(["script", "style", "textarea", "title"]);

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  aring: "å",
  Aring: "Å",
  auml: "ä",
  Auml: "Ä",
  ouml: "ö",
  Ouml: "Ö",
  eacute: "é",
  Eacute: "É",
  uuml: "ü",
  Uuml: "Ü",
  ndash: "–",
  mdash: "—",
  hellip: "…",
};

/** Decode the character references SchoolSoft's pages use; unknown ones stay as written. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref: string) => {
    if (ref[0] === "#") {
      const code =
        ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : Number(ref.slice(1));
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED[ref] ?? whole;
  });
}

export function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

const NAME = /[A-Za-z][A-Za-z0-9:-]*/y;
const ATTR_NAME = /[^\s"'>/=]+/y;
const SPACE = /\s*/y;

function readTag(html: string, start: number): { token: HtmlToken; end: number } {
  NAME.lastIndex = start + 1;
  const name = NAME.exec(html)![0].toLowerCase();
  let i = NAME.lastIndex;
  const attrs: HtmlAttr[] = [];
  for (;;) {
    SPACE.lastIndex = i;
    SPACE.exec(html);
    i = SPACE.lastIndex;
    if (i >= html.length)
      return { token: { kind: "open", name, attrs, selfClosing: false }, end: i };
    if (html.startsWith("/>", i))
      return { token: { kind: "open", name, attrs, selfClosing: true }, end: i + 2 };
    if (html[i] === ">")
      return { token: { kind: "open", name, attrs, selfClosing: false }, end: i + 1 };
    ATTR_NAME.lastIndex = i;
    const m = ATTR_NAME.exec(html);
    if (!m) {
      i++; // a stray quote or slash: skip it
      continue;
    }
    i = ATTR_NAME.lastIndex;
    SPACE.lastIndex = i;
    SPACE.exec(html);
    let value: string | null = null;
    if (html[SPACE.lastIndex] === "=") {
      i = SPACE.lastIndex + 1;
      SPACE.lastIndex = i;
      SPACE.exec(html);
      i = SPACE.lastIndex;
      const q = html[i];
      if (q === '"' || q === "'") {
        const close = html.indexOf(q, i + 1);
        value = html.slice(i + 1, close < 0 ? html.length : close);
        i = close < 0 ? html.length : close + 1;
      } else {
        const m2 = /[^\s>]*/y;
        m2.lastIndex = i;
        value = m2.exec(html)![0];
        i = m2.lastIndex;
      }
      value = decodeEntities(value);
    }
    attrs.push({ name: m[0].toLowerCase(), value });
  }
}

/** Split a document into tokens; text between tags is kept verbatim (entities undecoded). */
export function tokenize(html: string): HtmlToken[] {
  const out: HtmlToken[] = [];
  let i = 0;
  let text = "";
  const flush = () => {
    if (text) out.push({ kind: "text", text });
    text = "";
  };
  while (i < html.length) {
    const c = html[i];
    if (c !== "<") {
      text += c;
      i++;
      continue;
    }
    if (html.startsWith("<!--", i)) {
      flush();
      const end = html.indexOf("-->", i + 4);
      const stop = end < 0 ? html.length : end;
      out.push({ kind: "comment", text: html.slice(i + 4, stop) });
      i = end < 0 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith("<!", i) || html.startsWith("<?", i)) {
      flush();
      const end = html.indexOf(">", i);
      const stop = end < 0 ? html.length : end;
      out.push({ kind: "doctype", text: html.slice(i + 1, stop) });
      i = stop + 1;
      continue;
    }
    const close = /^<\/([A-Za-z][A-Za-z0-9:-]*)[^>]*>?/.exec(html.slice(i, i + 200));
    if (close) {
      flush();
      out.push({ kind: "close", name: close[1].toLowerCase() });
      i += close[0].length;
      continue;
    }
    if (!/[A-Za-z]/.test(html[i + 1] ?? "")) {
      text += c; // a lone "<" in text
      i++;
      continue;
    }
    flush();
    const { token, end } = readTag(html, i);
    out.push(token);
    i = end;
    if (token.kind === "open" && !token.selfClosing && RAW_ELEMENTS.has(token.name)) {
      const re = new RegExp(`</${token.name}\\s*>`, "i");
      const m = re.exec(html.slice(i));
      const stop = m ? i + m.index : html.length;
      if (stop > i) out.push({ kind: "raw", parent: token.name, text: html.slice(i, stop) });
      i = stop;
    }
  }
  flush();
  return out;
}

/** Put tokens back together; attribute values are re-escaped, text is written as given. */
export function serialize(tokens: HtmlToken[]): string {
  return tokens
    .map((t) => {
      switch (t.kind) {
        case "text":
        case "raw":
          return t.text;
        case "comment":
          return `<!--${t.text}-->`;
        case "doctype":
          return `<${t.text}>`;
        case "open": {
          const attrs = t.attrs
            .map((a) => (a.value === null ? ` ${a.name}` : ` ${a.name}="${escapeAttr(a.value)}"`))
            .join("");
          return `<${t.name}${attrs}${t.selfClosing ? " /" : ""}>`;
        }
        case "close":
          return `</${t.name}>`;
      }
    })
    .join("");
}
