/**
 * release-please bumps package.json itself; every other file that carries
 * the version is bumped only because it is listed under `extra-files` in
 * release-please-config.json. These tests replay a release bump the way
 * release-please's `json` updater (GenericJson) does it: replace the
 * X.Y.Z inside each string the jsonpath selects, then re-serialise the whole
 * file with JSON.stringify at the file's own indent. The result must pass
 * the host manifest validator and prettier, so a version pin that is
 * validated but not listed, or a listed file that no longer formats after
 * the rewrite, fails here instead of on main after the release PR merges.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as prettier from "prettier";
import { validatePlugins } from "../../scripts/validate-plugins.js";

const root = process.cwd();

interface ExtraFile {
  type: string;
  path: string;
  jsonpath: string;
}

/** release-please's VERSION_REGEX (src/updaters/generic-json.ts). */
const VERSION_REGEX = /(\d+)\.(\d+)\.(\d+)(-[\w.]+)?(\+[-\w.]+)?/;

function extraFiles(): ExtraFile[] {
  const config = JSON.parse(readFileSync(join(root, "release-please-config.json"), "utf8"));
  return config.packages["."]["extra-files"] as ExtraFile[];
}

/**
 * The subset of JSONPath the config uses: `$`, `.key`, `[n]`, `[*]`.
 * Anything else throws, so a richer path gets a matching change here.
 */
function select(
  data: unknown,
  jsonpath: string,
): { parent: Record<string, unknown>; key: string }[] {
  assert.match(
    jsonpath,
    /^\$(\.[A-Za-z_$][\w$]*|\[(\d+|\*)\])+$/,
    `unsupported jsonpath ${jsonpath}`,
  );
  const steps = [...jsonpath.matchAll(/\.([A-Za-z_$][\w$]*)|\[(\d+|\*)\]/g)].map(
    (m) => m[1] ?? m[2],
  );
  let nodes: { parent: Record<string, unknown>; key: string }[] = [
    { parent: { $: data }, key: "$" },
  ];
  for (const step of steps) {
    nodes = nodes.flatMap(({ parent, key }) => {
      const value = parent[key] as Record<string, unknown> | undefined;
      if (value === null || typeof value !== "object") return [];
      const keys = step === "*" ? Object.keys(value) : step in value ? [step] : [];
      return keys.map((k) => ({ parent: value, key: k }));
    });
  }
  return nodes;
}

/** What release-please writes for one file: GenericJson updates, then jsonStringify. */
function bump(content: string, jsonpaths: string[], version: string): string {
  const data = JSON.parse(content);
  for (const jsonpath of jsonpaths) {
    const hits = select(data, jsonpath);
    assert.ok(hits.length > 0, `${jsonpath} selects nothing`);
    for (const { parent, key } of hits) {
      const value = parent[key];
      assert.ok(
        typeof value === "string" && VERSION_REGEX.test(value),
        `${jsonpath} must select a string holding a version, got ${JSON.stringify(value)}`,
      );
      parent[key] = value.replace(VERSION_REGEX, version);
    }
  }
  const indent = /^([ \t]+)\S/m.exec(content)?.[1] ?? "";
  return (
    content.slice(0, content.indexOf("{")) +
    JSON.stringify(data, null, indent) +
    content.slice(content.lastIndexOf("}") + 1)
  );
}

function byFile(): Map<string, string[]> {
  const files = new Map<string, string[]>();
  for (const f of extraFiles()) {
    assert.equal(f.type, "json", `${f.path}: only json extra-files are replayed here`);
    files.set(f.path, [...(files.get(f.path) ?? []), f.jsonpath]);
  }
  return files;
}

test("every release-please extra-files entry selects the current package version", () => {
  const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  for (const f of extraFiles()) {
    const data = JSON.parse(readFileSync(join(root, f.path), "utf8"));
    const hits = select(data, f.jsonpath);
    assert.ok(hits.length > 0, `${f.path} ${f.jsonpath} selects nothing`);
    for (const { parent, key } of hits)
      assert.equal(
        VERSION_REGEX.exec(String(parent[key]))?.[0],
        version,
        `${f.path} ${f.jsonpath} is not at package.json's ${version}`,
      );
  }
});

test("a replayed release bump keeps every host manifest valid and prettier-clean", async () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const [major, minor, patch] = (pkg.version as string).split(/[.-]/).map(Number);
  const next = `${major}.${minor}.${patch + 1}`;
  const sandbox = mkdtempSync(join(tmpdir(), "release-sync-"));
  try {
    cpSync(join(root, "plugins"), join(sandbox, "plugins"), { recursive: true });
    writeFileSync(
      join(sandbox, "package.json"),
      JSON.stringify({ ...pkg, version: next }, null, 2) + "\n",
    );
    for (const [path, jsonpaths] of byFile()) {
      const bumped = bump(readFileSync(join(root, path), "utf8"), jsonpaths, next);
      writeFileSync(join(sandbox, path), bumped);
      const options = (await prettier.resolveConfig(join(root, path))) ?? {};
      assert.ok(
        await prettier.check(bumped, { ...options, filepath: join(root, path) }),
        `${path}: prettier rejects release-please's rewrite (json-stringify override in .prettierrc?)`,
      );
    }
    assert.deepEqual(validatePlugins(sandbox), []);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
