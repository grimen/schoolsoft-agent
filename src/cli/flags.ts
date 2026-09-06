/**
 * Derive CLI flags from an operation's Zod input shape, and parse
 * commander's option object back into operation args.
 *
 * Supported: ZodNumber, ZodString, ZodBoolean, ZodEnum, each optionally
 * wrapped in ZodOptional. Anything else throws at build time (and the
 * boundary test guards the registry), so unsupported shapes never reach
 * users.
 */
import { z } from "zod";
import { InputError } from "../core/index.js";

export interface FlagSpec {
  /** Operation argument key, e.g. "child_id". */
  key: string;
  /** commander flag, e.g. "--child-id <number>". */
  flag: string;
  /** commander's camelCase option name, e.g. "childId". */
  optionName: string;
  kind: "number" | "string" | "boolean" | "enum";
  required: boolean;
  description: string;
  choices?: string[];
}

export function kebab(s: string): string {
  return s.replace(/_/g, "-");
}

export function camel(s: string): string {
  return s.replace(/[-_]([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

function unwrap(schema: z.ZodTypeAny): { inner: z.ZodTypeAny; optional: boolean } {
  if (schema instanceof z.ZodOptional)
    return { inner: schema.unwrap() as z.ZodTypeAny, optional: true };
  if (schema instanceof z.ZodDefault)
    return { inner: schema.def.innerType as z.ZodTypeAny, optional: true };
  return { inner: schema, optional: false };
}

export function flagsFromSchema(shape: z.ZodRawShape): FlagSpec[] {
  const specs: FlagSpec[] = [];
  for (const [key, raw] of Object.entries(shape)) {
    const { inner, optional } = unwrap(raw as z.ZodTypeAny);
    const description = (raw as z.ZodTypeAny).description ?? inner.description ?? "";
    const name = kebab(key);
    if (inner instanceof z.ZodNumber) {
      specs.push({
        key,
        flag: `--${name} <number>`,
        optionName: camel(key),
        kind: "number",
        required: !optional,
        description,
      });
    } else if (inner instanceof z.ZodString) {
      specs.push({
        key,
        flag: `--${name} <value>`,
        optionName: camel(key),
        kind: "string",
        required: !optional,
        description,
      });
    } else if (inner instanceof z.ZodBoolean) {
      specs.push({
        key,
        flag: `--${name}`,
        optionName: camel(key),
        kind: "boolean",
        required: false,
        description,
      });
    } else if (inner instanceof z.ZodEnum) {
      const choices = Object.values(inner.enum as Record<string, string>);
      specs.push({
        key,
        flag: `--${name} <choice>`,
        optionName: camel(key),
        kind: "enum",
        required: !optional,
        description,
        choices,
      });
    } else {
      throw new Error(`Unsupported input schema for "${key}": ${inner.constructor.name}`);
    }
  }
  return specs;
}

/** Turn commander's parsed options into operation args (snake_case keys). */
export function parseFlags(
  specs: FlagSpec[],
  opts: Record<string, unknown>,
): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const s of specs) {
    const v = opts[s.optionName];
    if (v === undefined) continue;
    if (s.kind === "number") {
      const n = Number(v);
      if (!Number.isFinite(n))
        throw new InputError(`--${kebab(s.key)} must be a number, got "${String(v)}"`);
      args[s.key] = n;
    } else if (s.kind === "boolean") {
      args[s.key] = Boolean(v);
    } else if (s.kind === "enum") {
      if (!s.choices?.includes(String(v))) {
        throw new InputError(`--${kebab(s.key)} must be one of ${s.choices?.join(", ")}`);
      }
      args[s.key] = String(v);
    } else {
      args[s.key] = String(v);
    }
  }
  return args;
}
