import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, cpSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validatePlugins } from "../../scripts/validate-plugins.js";
import { buildSkills, mergeFrontmatter, HOSTS } from "../../scripts/gen-skills.js";
import { parseFrontmatter } from "./skill.test.js";
import { envSource, resolveConfig, defaultConfigDir } from "../../src/core/config.js";

test("all host manifests validate structurally", () => {
  assert.deepEqual(validatePlugins(process.cwd()), []);
});

/**
 * Replays how @anthropic-ai/mcpb's `getMcpConfigForManifest` (shared/config.js)
 * turns manifest.user_config + a host-supplied userConfig into the server's
 * env vars: unset keys fall back to `default`, then every "${user_config.x}"
 * placeholder in mcp_config is substituted with String(value) via a plain
 * string replace. Crucially, a key with NO `default` and no explicit
 * userConfig value never enters the substitution table at all, so its
 * placeholder is left in the string verbatim — only an explicit default
 * (including "") guarantees substitution happens.
 */
function mcpbEnv(manifest: any, userConfig: Record<string, unknown> = {}): Record<string, string> {
  const merged: Record<string, unknown> = { ...userConfig };
  for (const [key, opt] of Object.entries<any>(manifest.user_config ?? {})) {
    if (!(key in merged) && opt.default !== undefined) merged[key] = opt.default;
  }
  const vars: Record<string, string> = {};
  for (const [key, value] of Object.entries(merged)) vars[`user_config.${key}`] = String(value);
  const env: Record<string, string> = {};
  for (const [name, template] of Object.entries<string>(manifest.server.mcp_config.env)) {
    env[name] = template.replace(/\$\{([^}]+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  }
  return env;
}

test("mcpb manifest's config_dir has no hard-coded default path, so an unset config_dir substitutes to an empty string (not a literal placeholder)", () => {
  const manifest = JSON.parse(
    readFileSync(join(process.cwd(), "plugins/mcpb/manifest.json"), "utf8"),
  );
  const opt = manifest.user_config.config_dir;
  assert.equal(opt.required, false);
  assert.equal(opt.default, "", "default must be empty, never a hard-coded path");

  const env = mcpbEnv(manifest);
  assert.equal(
    env.SCHOOLSOFT_CONFIG_DIR,
    "",
    "unset config_dir must substitute cleanly, not leak ${user_config.config_dir}",
  );
});

test("an existing macOS Application Support folder keeps being used; Windows and Linux get their own platform defaults", () => {
  const manifest = JSON.parse(
    readFileSync(join(process.cwd(), "plugins/mcpb/manifest.json"), "utf8"),
  );

  for (const [platform, home, env] of [
    ["darwin", "/Users/j", {}],
    ["win32", "C:\\Users\\j", { APPDATA: "C:\\Users\\j\\AppData\\Roaming" }],
    ["linux", "/home/j", {}],
  ] as const) {
    // What the mcpb host would pass through as SCHOOLSOFT_CONFIG_DIR when the
    // user leaves the field blank.
    const hostEnv = { SCHOOLSOFT_CONFIG_DIR: mcpbEnv(manifest).SCHOOLSOFT_CONFIG_DIR, ...env };
    const config = resolveConfig([envSource(hostEnv), { school: "taby" }], {
      home,
      platform,
      env: hostEnv,
    });
    assert.equal(config.configDir, defaultConfigDir(home, platform, env));
  }

  // The darwin case must resolve to exactly the pre-existing macOS folder
  // that earlier extension versions already wrote session/history into.
  assert.equal(
    defaultConfigDir("/Users/j", "darwin"),
    "/Users/j/Library/Application Support/schoolsoft-agent",
  );
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
