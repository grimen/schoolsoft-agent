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

const files = [
  join(process.cwd(), "README.md"),
  ...mdFiles(join(process.cwd(), "docs")),
  ...mdFiles(join(process.cwd(), "skills")),
];

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

test("every diagram source has a rendered SVG, and vice versa; architecture embeds each", () => {
  const src = join(process.cwd(), "docs/diagrams/src");
  const dist = join(process.cwd(), "docs/diagrams/dist");
  const mmd = readdirSync(src)
    .filter((f) => f.endsWith(".mmd"))
    .map((f) => f.replace(/\.mmd$/, ""))
    .sort();
  const svg = readdirSync(dist)
    .filter((f) => f.endsWith(".svg"))
    .map((f) => f.replace(/\.svg$/, ""))
    .sort();
  assert.deepEqual(svg, mmd, "run make diagrams");
  assert.ok(mmd.length >= 5, `expected at least 5 diagrams, found ${mmd.length}`);
  const arch = readFileSync(join(process.cwd(), "docs/architecture.md"), "utf8");
  for (const n of mmd) {
    assert.match(
      arch,
      new RegExp(`\\(diagrams/dist/${n}\\.svg\\)\\]\\(diagrams/src/${n}\\.mmd\\)`),
      `architecture.md must embed ${n}`,
    );
  }
  for (const f of files) {
    const md = readFileSync(f, "utf8");
    assert.ok(
      !md.includes("```mermaid"),
      `${f}: inline mermaid — put it under docs/diagrams/src and embed the SVG`,
    );
  }
});
