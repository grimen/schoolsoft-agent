/**
 * Form STRUCTURE from a captured page: every form's action and method and
 * each field's name, type, required flag and choices. Values the page
 * prefilled are never recorded (only that one was there); choice codes,
 * labels and names go through the Redactor. Nothing is submitted: this
 * reads HTML the probe already fetched with a GET.
 */
import { decodeEntities, tokenize, type HtmlAttr } from "./html.js";
import type { Redactor } from "./redact.js";

export interface CapturedOption {
  value: string | null;
  label: string;
  selected: boolean;
}

export interface CapturedField {
  tag: "input" | "select" | "textarea" | "button";
  type: string;
  name: string | null;
  id: string | null;
  required: boolean;
  /** Text of a `<label for>` pointing at the field, or the button's caption. */
  label?: string;
  /** Code of a radio button or checkbox. */
  value?: string;
  checked?: boolean;
  multiple?: boolean;
  options?: CapturedOption[];
  /** The page filled in a default (the value itself is not recorded). */
  prefilled: boolean;
}

export interface CapturedForm {
  name: string | null;
  id: string | null;
  action: string;
  method: string;
  enctype: string | null;
  fields: CapturedField[];
}

const get = (attrs: HtmlAttr[], name: string): string | null => {
  const a = attrs.find((x) => x.name === name);
  return a ? (a.value ?? "") : null;
};

export function extractForms(html: string, r: Redactor): CapturedForm[] {
  const forms: CapturedForm[] = [];
  const labels = new Map<string, string>();
  const rawIds = new Map<CapturedField, string>();
  let form: CapturedForm | null = null;
  let select: CapturedField | null = null;
  /** Where text is being collected, and what to do with it at the closing tag. */
  let collecting: { tag: string; text: string; done: (text: string) => void } | null = null;

  const finish = () => {
    if (collecting) collecting.done(collecting.text.replace(/\s+/g, " ").trim());
    collecting = null;
  };
  const field = (tag: CapturedField["tag"], type: string, attrs: HtmlAttr[]): CapturedField => {
    const id = get(attrs, "id");
    const f: CapturedField = {
      tag,
      type,
      name: r.digits(get(attrs, "name") ?? "") || null,
      id: id ? r.digits(id) : null,
      required: get(attrs, "required") !== null || get(attrs, "aria-required") === "true",
      prefilled: false,
    };
    if (id) rawIds.set(f, id);
    form!.fields.push(f);
    return f;
  };

  for (const t of tokenize(html)) {
    if (t.kind === "text" || (t.kind === "raw" && t.parent !== "script" && t.parent !== "style")) {
      if (collecting) collecting.text += decodeEntities(t.text);
      continue;
    }
    if (t.kind === "close") {
      if (collecting?.tag === t.name || (t.name === "select" && collecting)) finish();
      if (t.name === "select") select = null;
      if (t.name === "form") form = null;
      continue;
    }
    if (t.kind !== "open") continue;
    const { name: tag, attrs } = t;
    if (tag === "label") {
      const target = get(attrs, "for");
      if (target) collecting = { tag, text: "", done: (text) => labels.set(target, r.text(text)) };
      continue;
    }
    if (tag === "form") {
      form = {
        name: get(attrs, "name"),
        id: get(attrs, "id"),
        action: r.url(get(attrs, "action") ?? ""),
        method: (get(attrs, "method") || "get").toLowerCase(),
        enctype: get(attrs, "enctype"),
        fields: [],
      };
      forms.push(form);
      continue;
    }
    if (!form) continue;
    if (tag === "input") {
      const type = (get(attrs, "type") || "text").toLowerCase();
      const f = field("input", type, attrs);
      const value = get(attrs, "value") ?? "";
      if (type === "radio" || type === "checkbox") {
        f.value = r.code(value);
        f.checked = get(attrs, "checked") !== null;
      } else if (type === "submit" || type === "button" || type === "reset") {
        f.label = r.text(value);
      } else {
        f.prefilled = value !== "";
      }
    } else if (tag === "select") {
      select = field("select", "select", attrs);
      select.options = [];
      if (get(attrs, "multiple") !== null) select.multiple = true;
    } else if (tag === "option" && select) {
      finish();
      const option: CapturedOption = {
        value: ((v) => (v === null ? null : r.code(v)))(get(attrs, "value")),
        label: "",
        selected: get(attrs, "selected") !== null,
      };
      select.options!.push(option);
      collecting = { tag, text: "", done: (text) => (option.label = r.text(text)) };
    } else if (tag === "textarea") {
      const f = field("textarea", "textarea", attrs);
      collecting = { tag, text: "", done: (text) => (f.prefilled = text !== "") };
    } else if (tag === "button") {
      const f = field("button", (get(attrs, "type") || "submit").toLowerCase(), attrs);
      collecting = { tag, text: "", done: (text) => (f.label = r.text(text)) };
    }
  }
  finish();
  for (const f of forms.flatMap((x) => x.fields)) {
    const label = labels.get(rawIds.get(f) ?? "");
    if (label !== undefined) f.label = label;
  }
  for (const x of forms) {
    x.name = x.name === null ? null : r.digits(x.name);
    x.id = x.id === null ? null : r.digits(x.id);
  }
  return forms;
}
