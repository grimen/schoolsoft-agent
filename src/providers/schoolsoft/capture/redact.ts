/**
 * The capture probe's redactor. Fail closed: a text is kept only when it is
 * a date, a time, a short number or made entirely of SchoolSoft interface
 * words (vocabulary.ts); everything else becomes a placeholder. Identifiers
 * become stable placeholders, so the same id or text maps to the same
 * placeholder within one capture (one Redactor instance) and the fixture
 * keeps its internal references. Names known from the session (children,
 * guardian, school) are never kept, even when they look like interface words.
 */
import {
  decodeEntities,
  escapeText,
  serialize,
  tokenize,
  type HtmlAttr,
  type HtmlToken,
} from "./html.js";
import { INTERFACE_WORDS, SAFE_VALUES } from "./vocabulary.js";

const DATE_TIME =
  /\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?|\b\d{1,2}[:.]\d{2}\b/g;
const HEX_COLOR = /^#[0-9a-f]{3,8}$/i;
/** What may surround interface words: digits (few), punctuation, whitespace. */
const FILLER = /^[\s\d.,:;!?%&+\-–—/()[\]*|#…"'«»]*$/;
const LETTER_WORD = /\p{L}[\p{L}.]*/gu;
const MAX_LOOSE_DIGITS = 4;
/** JSON keys whose values are identifiers. */
const ID_KEY = /(?:^id|Id|ID|_id|Ids|IDs|_ids)$/;
/** An identifier-looking code (option value, query value, enum). */
const CODE = /^(?:\d{1,2}|[a-z_][a-z0-9_-]{0,23}|[A-Z][A-Z0-9_]{1,30})$/;
const LONG_DIGITS = /\d{3,}/g;

const KEEP_ATTRS = new Set([
  "type",
  "method",
  "enctype",
  "colspan",
  "rowspan",
  "width",
  "height",
  "align",
  "valign",
  "border",
  "cellpadding",
  "cellspacing",
  "size",
  "maxlength",
  "minlength",
  "rows",
  "cols",
  "tabindex",
  "role",
  "checked",
  "selected",
  "disabled",
  "readonly",
  "required",
  "multiple",
  "charset",
  "lang",
  "rel",
  "media",
  "target",
  "autocomplete",
  "http-equiv",
  "scope",
  "nowrap",
  "style",
  "hidden",
  "novalidate",
]);
const IDENT_ATTRS = new Set(["id", "class", "name", "for", "form", "headers", "list"]);
const URL_ATTRS = new Set(["href", "src", "action", "formaction", "background"]);
/** value is a visible label on these input types. */
const LABEL_INPUTS = new Set(["submit", "button", "reset"]);
/** value is a choice code on these. */
const CHOICE_INPUTS = new Set(["radio", "checkbox"]);

export interface RedactorOptions {
  /** Names from the session (children, guardian, school, tenant slug): never kept anywhere. */
  knownNames?: readonly string[];
}

export class Redactor {
  private readonly ids = new Map<string, number>();
  private readonly texts = new Map<string, number>();
  private readonly names: Set<string>;

  constructor(o: RedactorOptions = {}) {
    this.names = new Set((o.knownNames ?? []).flatMap((n) => words(n)).filter((w) => w.length > 1));
  }

  /** Lower-cased words of the known names, for the promote check's denylist. */
  knownWords(): string[] {
    return [...this.names];
  }

  private hasKnownName(s: string): boolean {
    return words(s).some((w) => this.names.has(w));
  }

  /** Stable numeric placeholder for an identifier (1001, 1002, ...). */
  idNumber(raw: string | number): number {
    const key = String(raw);
    let n = this.ids.get(key);
    if (n === undefined) {
      n = this.ids.size + 1;
      this.ids.set(key, n);
    }
    return 1000 + n;
  }

  /** Placeholder of the same type: digits stay digits, anything else becomes `id-N`. */
  idString(raw: string): string {
    return /^\d+$/.test(raw) ? String(this.idNumber(raw)) : `id-${this.idNumber(raw) - 1000}`;
  }

  /** Every run of three or more digits replaced (element ids, field names). */
  digits(s: string): string {
    return s.replace(LONG_DIGITS, (d) => String(this.idNumber(d)));
  }

  /** True when a text may appear in a fixture as it is. */
  isSafeText(raw: string): boolean {
    const s = raw.replace(/\s+/g, " ").trim();
    if (s === "") return true;
    if (this.hasKnownName(s)) return false;
    if (HEX_COLOR.test(s)) return true;
    const loose = s.replace(DATE_TIME, " ");
    const found = loose.match(LETTER_WORD) ?? [];
    if (!found.every((w) => INTERFACE_WORDS.has(w.toLowerCase().replace(/\.+$/, "")))) return false;
    const rest = loose.replace(LETTER_WORD, " ");
    return FILLER.test(rest) && (rest.match(/\d/g) ?? []).length <= MAX_LOOSE_DIGITS;
  }

  /** The text itself when safe, else a stable `[text N]` placeholder. */
  text(raw: string): string {
    if (this.isSafeText(raw)) return raw;
    const key = raw.replace(/\s+/g, " ").trim();
    let n = this.texts.get(key);
    if (n === undefined) {
      n = this.texts.size + 1;
      this.texts.set(key, n);
    }
    return `[text ${n}]`;
  }

  /** A choice or enum code: kept when it looks like one, an id when numeric, else a text. */
  code(raw: string): string {
    if (raw === "") return raw;
    if (CODE.test(raw) && !this.hasKnownName(raw)) return raw;
    if (/^\d+$/.test(raw)) return this.idString(raw);
    return this.text(raw);
  }

  url(raw: string): string {
    const scheme = /^(mailto|tel|sms):/i.exec(raw);
    if (scheme) return `${scheme[1].toLowerCase()}:[redacted]`;
    if (/^javascript:/i.test(raw)) return "javascript:" + this.script(raw.slice(11));
    const hashAt = raw.indexOf("#");
    const hash = hashAt < 0 ? "" : "#" + this.code(raw.slice(hashAt + 1));
    const base = hashAt < 0 ? raw : raw.slice(0, hashAt);
    const q = base.indexOf("?");
    const path = (q < 0 ? base : base.slice(0, q))
      .split("/")
      .map((seg) => this.pathSegment(seg))
      .join("/");
    if (q < 0) return path + hash;
    const query = base
      .slice(q + 1)
      .split("&")
      .map((pair) => {
        const eq = pair.indexOf("=");
        const k = eq < 0 ? pair : pair.slice(0, eq);
        const key =
          /^[\w.-]+$/.test(k) && !this.hasKnownName(k) ? k : encodeURIComponent(this.text(k));
        if (eq < 0) return key;
        const v = safeDecode(pair.slice(eq + 1));
        const value = /id$/i.test(k) && v !== "" ? this.idString(v) : this.code(v);
        return `${key}=${encodeURIComponent(value)}`;
      })
      .join("&");
    return `${path}?${query}${hash}`;
  }

  private pathSegment(seg: string): string {
    const s = this.digits(seg);
    if (/^[a-z0-9_.:-]*$/.test(s) && !this.hasKnownName(s)) return s;
    return encodeURIComponent(this.text(safeDecode(seg)));
  }

  /** Inline script (event handlers, javascript: URLs): string literals and long numbers redacted. */
  script(raw: string): string {
    return raw.replace(/(["'])((?:\\.|(?!\1).)*)\1|\d{3,}/g, (m, quote?: string, body?: string) => {
      if (quote === undefined) return String(this.idNumber(m));
      const inner = /^[\w./-]+\?/.test(body!) ? this.url(body!) : this.code(body!);
      return quote + inner + quote;
    });
  }

  private attr(tag: string, type: string, a: HtmlAttr): HtmlAttr {
    const { name, value } = a;
    if (value === null || KEEP_ATTRS.has(name)) return a;
    if (IDENT_ATTRS.has(name)) return { name, value: this.digits(value) };
    if (URL_ATTRS.has(name)) return { name, value: this.url(value) };
    if (name.startsWith("on")) return { name, value: this.script(value) };
    if (name === "value") {
      if (tag === "option" || (tag === "input" && CHOICE_INPUTS.has(type)))
        return { name, value: this.code(value) };
      if (tag === "input" && LABEL_INPUTS.has(type)) return { name, value: this.text(value) };
      return { name, value: "" };
    }
    if (name.startsWith("data-") && /^\d+$/.test(value))
      return { name, value: this.idString(value) };
    return { name, value: this.text(value) };
  }

  /** A whole page: tags kept, text and attribute values redacted, comments and scripts dropped. */
  html(source: string): string {
    const out = tokenize(source).flatMap((t): HtmlToken[] => {
      switch (t.kind) {
        case "comment":
          return [];
        case "text": {
          const plain = decodeEntities(t.text);
          const kept = this.text(plain);
          return [kept === plain ? t : { ...t, text: escapeText(kept) }];
        }
        case "raw":
          if (t.parent === "style") return [t];
          if (t.parent === "title")
            return [{ ...t, text: escapeText(this.text(decodeEntities(t.text))) }];
          return []; // script bodies and textarea contents
        case "open": {
          const type = (t.attrs.find((a) => a.name === "type")?.value ?? "").toLowerCase();
          return [{ ...t, attrs: t.attrs.map((a) => this.attr(t.name, type, a)) }];
        }
        default:
          return [t];
      }
    });
    return serialize(out);
  }

  /** Any JSON value: ids by key, texts by the text rule, dates, booleans and small numbers kept. */
  json(value: unknown, key = ""): unknown {
    if (Array.isArray(value)) return value.map((v) => this.json(v, key));
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [
          /^\d{3,}$/.test(k) ? this.digits(k) : k,
          this.json(v, k),
        ]),
      );
    }
    if (typeof value === "number") {
      return ID_KEY.test(key) || (Number.isInteger(value) && Math.abs(value) >= 100_000)
        ? this.idNumber(value)
        : value;
    }
    if (typeof value === "string") {
      if (ID_KEY.test(key)) return value === "" ? value : this.idString(value);
      if (SAFE_VALUES.has(value)) return value;
      return this.code(value);
    }
    return value;
  }
}

function words(s: string): string[] {
  return (s.match(/\p{L}+/gu) ?? []).map((w) => w.toLowerCase());
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch {
    return s;
  }
}
