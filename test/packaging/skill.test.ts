/**
 * The skill folder must satisfy the Agent Skills spec (agentskills.io):
 * name matches the directory and the slug regex, description ≤ 1024,
 * body < 500 lines, referenced files exist, wrapper script executable.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, basename } from "node:path";

export const SKILL_DIR = join(process.cwd(), "skills", "schoolsoft");

export function parseFrontmatter(md: string): { data: Record<string, string>; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(md);
  assert.ok(m, "SKILL.md must start with YAML frontmatter");
  const data: Record<string, string> = {};
  for (const line of m![1].split("\n")) {
    const kv = /^([a-zA-Z_-]+):\s*(.*)$/.exec(line);
    if (kv) data[kv[1]] = kv[2].trim();
  }
  return { data, body: m![2] };
}

test("SKILL.md frontmatter follows the Agent Skills spec", () => {
  const md = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8");
  const { data, body } = parseFrontmatter(md);
  assert.match(data.name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  assert.equal(data.name, basename(SKILL_DIR));
  assert.ok(data.name.length <= 64);
  assert.ok(data.description.length > 0 && data.description.length <= 1024);
  assert.ok(!/anthropic|claude/i.test(data.name));
  assert.ok(body.split("\n").length < 500);
  assert.equal(data.license, "MIT");
});

test("skill references and scripts exist and the wrapper is executable", () => {
  const md = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8");
  for (const [, rel] of md.matchAll(/\]\((references\/[^)]+)\)/g)) {
    assert.ok(existsSync(join(SKILL_DIR, rel)), `missing ${rel}`);
  }
  const script = join(SKILL_DIR, "scripts", "schoolsoft.sh");
  assert.ok(existsSync(script));
  assert.ok(statSync(script).mode & 0o111, "schoolsoft.sh must be executable");
  assert.match(md, /scripts\/schoolsoft\.sh/);
});
