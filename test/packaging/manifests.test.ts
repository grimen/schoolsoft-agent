import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, cpSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validatePlugins } from "../../scripts/validate-plugins.js";
import { buildSkills, mergeFrontmatter, HOSTS } from "../../scripts/gen-skills.js";
import { parseFrontmatter } from "./skill.test.js";

test("all host manifests validate structurally", () => {
  assert.deepEqual(validatePlugins(process.cwd()), []);
});

test("mergeFrontmatter appends host metadata under the existing metadata block and keeps the body", () => {
  const md = "---\nname: schoolsoft\ndescription: d\nmetadata:\n  author: x\n---\n# Body\nText\n";
  const out = mergeFrontmatter(md, { hermes: { category: "education", tags: ["a", "b"] } });
  assert.match(
    out,
    /metadata:\n  author: x\n  hermes:\n    category: education\n    tags:\n      - a\n      - b\n---\n# Body\nText\n$/,
  );
  const noMeta = mergeFrontmatter("---\nname: s\n---\nB\n", { pi: { x: 1 } });
  assert.match(noMeta, /name: s\nmetadata:\n  pi:\n    x: 1\n---\nB\n$/);
});

test("buildSkills produces one folder per host with merged metadata and an unchanged body", () => {
  const src = readFileSync(join(process.cwd(), "skills/schoolsoft/SKILL.md"), "utf8");
  const { body } = parseFrontmatter(src);
  // Build into a scratch copy of the repo layout to avoid touching dist/ in tests.
  const root = mkdtempSync(join(tmpdir(), "skills-"));
  mkdirSync(join(root, "plugins/claude/schoolsoft-skill"), { recursive: true });
  cpSync(join(process.cwd(), "skills"), join(root, "skills"), { recursive: true });
  for (const h of HOSTS) {
    const f = join(process.cwd(), "plugins", h, "skill-metadata.json");
    if (existsSync(f)) {
      mkdirSync(join(root, "plugins", h), { recursive: true });
      cpSync(f, join(root, "plugins", h, "skill-metadata.json"));
    }
  }
  const written = buildSkills(root);
  assert.equal(written.length, HOSTS.length + 1);
  for (const dir of written) {
    const md = readFileSync(join(dir, "SKILL.md"), "utf8");
    const parsed = parseFrontmatter(md);
    assert.equal(parsed.body, body, `${dir}: body changed`);
    assert.equal(parsed.data.name, "schoolsoft");
    assert.ok(existsSync(join(dir, "scripts/schoolsoft.sh")));
    assert.ok(existsSync(join(dir, "references/commands.md")));
  }
  assert.match(
    readFileSync(join(root, "dist/skills/hermes/schoolsoft/SKILL.md"), "utf8"),
    /hermes:\n\s+category: education/,
  );
  assert.match(
    readFileSync(join(root, "dist/skills/openclaw/schoolsoft/SKILL.md"), "utf8"),
    /openclaw:\n\s+emoji: 🏫/,
  );
});

test("the committed Claude skill copy matches the source (run make skills)", () => {
  const src = readFileSync(join(process.cwd(), "skills/schoolsoft/SKILL.md"), "utf8");
  const copy = readFileSync(
    join(process.cwd(), "plugins/claude/schoolsoft-skill/skills/schoolsoft/SKILL.md"),
    "utf8",
  );
  assert.equal(copy, src);
  assert.equal(
    readFileSync(
      join(
        process.cwd(),
        "plugins/claude/schoolsoft-skill/skills/schoolsoft/references/commands.md",
      ),
      "utf8",
    ),
    readFileSync(join(process.cwd(), "skills/schoolsoft/references/commands.md"), "utf8"),
  );
});
