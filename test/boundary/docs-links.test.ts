/**
 * Documentation sanity: every relative link in Markdown under docs/, the
 * README, and the skill resolves to a file; every Mermaid block has a
 * known diagram type and balanced fences.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

function mdFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (!/node_modules|dist|superpowers/.test(p)) mdFiles(p, out);
    } else if (p.endsWith(".md")) out.push(p);
  }
  return out;
}

const files = [join(process.cwd(), "README.md"), ...mdFiles(join(process.cwd(), "docs")), ...mdFiles(join(process.cwd(), "skills"))];

test("relative links in docs resolve", () => {
  const broken: string[] = [];
  for (const f of files) {
    const md = readFileSync(f, "utf8");
    for (const m of md.matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)/g)) {
      const target = m[1];
      if (/^[a-z]+:/.test(target)) continue; // http(s), mailto
      if (!existsSync(resolve(dirname(f), target))) broken.push(`${f} → ${target}`);
    }
  }
  assert.deepEqual(broken, []);
});

test("mermaid blocks are well-formed", () => {
  const types = /^(flowchart|graph|sequenceDiagram|stateDiagram-v2|classDiagram|erDiagram)\b/;
  let count = 0;
  for (const f of files) {
    const md = readFileSync(f, "utf8");
    const fences = md.split("```");
    assert.equal(fences.length % 2, 1, `${f}: unbalanced code fences`);
    for (let i = 1; i < fences.length; i += 2) {
      if (!fences[i].startsWith("mermaid")) continue;
      const body = fences[i].replace(/^mermaid\s*\n/, "").trim();
      assert.match(body, types, `${f}: mermaid block without a known diagram type`);
      count++;
    }
  }
  assert.ok(count >= 5, `expected at least 5 mermaid diagrams, found ${count}`);
});
