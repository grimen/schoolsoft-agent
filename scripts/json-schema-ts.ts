/**
 * A small JSON Schema → TypeScript emitter for the typed client's generated types
 * (src/client/api.gen.ts). It covers what `z.toJSONSchema` produces for the REST
 * answers: objects, arrays, unions (`anyOf`, `oneOf`, type lists), `const`, `enum`,
 * strings, numbers, booleans and null, with descriptions as doc comments. Anything it
 * does not know becomes `unknown` rather than a guess.
 */
interface Node {
  type?: string | string[];
  const?: unknown;
  enum?: unknown[];
  anyOf?: Node[];
  oneOf?: Node[];
  items?: Node;
  properties?: Record<string, Node>;
  required?: string[];
  description?: string;
}

const PRIMITIVE: Record<string, string> = {
  string: "string",
  integer: "number",
  number: "number",
  boolean: "boolean",
  null: "null",
};

function comment(text: string | undefined, indent: string): string {
  return text ? `${indent}/** ${text.replaceAll("*/", "*\\/")} */\n` : "";
}

const union = (parts: string[]) =>
  [...new Set(parts)].map((part) => (part.includes("\n") ? `(${part})` : part)).join(" | ");

/** The TypeScript type of a JSON Schema node, indented for nesting at `depth`. */
export function tsType(node: Node, depth = 0): string {
  if (node.const !== undefined) return JSON.stringify(node.const);
  if (node.enum) return union(node.enum.map((value) => JSON.stringify(value)));
  const alternatives = node.anyOf ?? node.oneOf;
  if (alternatives) return union(alternatives.map((alt) => tsType(alt, depth)));
  if (Array.isArray(node.type))
    return union(node.type.map((type) => tsType({ ...node, type }, depth)));
  if (node.type === "array") {
    const item = tsType(node.items ?? {}, depth);
    return /[ |\n]/.test(item) ? `Array<${item}>` : `${item}[]`;
  }
  if (node.type === "object") {
    const indent = "  ".repeat(depth + 1);
    const required = new Set(node.required ?? []);
    const fields = Object.entries(node.properties ?? {}).map(
      ([key, child]) =>
        comment(child.description, indent) +
        `${indent}${/^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key)}${required.has(key) ? "" : "?"}: ${tsType(child, depth + 1)};`,
    );
    return fields.length
      ? `{\n${fields.join("\n")}\n${"  ".repeat(depth)}}`
      : "Record<string, unknown>";
  }
  return (node.type && PRIMITIVE[node.type]) ?? "unknown";
}

/** `export type Name = …;` with the schema's description as its doc comment. */
export function tsDeclaration(name: string, node: Node): string {
  return `${comment(node.description, "")}export type ${name} = ${tsType(node)};\n`;
}
