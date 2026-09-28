/**
 * Import-boundary checker (also exercised by test/boundary/imports.test.ts).
 *   - src/core/** must not import src/mcp, src/cli, src/http or node:process
 *   - src/mcp/**, src/cli/**, src/http/**, src/shared/** import core only via ../core/index.js
 *   - adapters never import each other; src/shared is the place for common adapter code
 *   - src/core/** must not reference `process.env`
 *   - src/providers/** is reached from core only through src/core/wiring.ts (the composition root);
 *     adapters never import a provider; providers import core modules directly, never core/index.ts
 *     or core/wiring.ts (that would be a cycle)
 *   - outbound requests (the request budget, docs/planning/specs/2026-09-26-request-budget.md):
 *     only a provider's net.ts calls `fetch`; nothing imports `@elias4044/ssp-node`, whose helpers
 *     sent requests around the budget (docs/planning/specs/2026-09-26-drop-ssp-node.md); only the
 *     inbound servers import node:http(s)/net/tls/undici
 *   - src/client/** (the typed client, a package export for apps) imports only zod and its own
 *     files, and nothing else in src imports it
 *   - files and directories are created only through src/core/private-files.ts (0700/0600):
 *     nothing else imports a file-creating node:fs function, or node:fs as a whole
 *     (docs/planning/specs/2026-09-26-privacy-small-fixes.md)
 *   - packages/app/{app,src}/** (the Expo app) imports nothing from the root package but
 *     `schoolsoft-agent/client`, and no root src/ path (docs/planning/specs/2026-09-26-app-workspace.md)
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, dirname, resolve, posix } from "node:path";

export interface Violation {
  file: string;
  line: number;
  message: string;
}

function walk(dir: string, out: string[] = [], extensions: string[] = [".ts"]): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out, extensions);
    else if (extensions.some((ext) => p.endsWith(ext))) out.push(p);
  }
  return out;
}

/** Where a provider's one budgeted transport lives. */
const TRANSPORT = /^providers\/[^/]+\/net\.ts$/;
/** Inbound servers only: the OAuth callback listener and the connector's own HTTP server. */
const NETWORK_MODULE_ALLOWED = new Set(["core/auth/callback-server.ts"]);
/** The student client this project used to depend on; its helpers sent around the budget. */
const DROPPED =
  /\bfrom\s*["']@elias4044\/ssp-node["']|\bimport\s*\(\s*["']@elias4044\/ssp-node["']\s*\)/g;

/** The outbound rules for one file (whole text, so multi-line imports count too). */
function checkOutbound(rel: string, text: string): Violation[] {
  const out: Violation[] = [];
  // The typed client talks to a connector, never to the school portal, and runs in the
  // app that imports it; the portal-outbound rules are not about it (its own rule is below).
  if (rel.startsWith("client/")) return out;
  const lineOf = (index: number) => text.slice(0, index).split("\n").length;
  const add = (index: number, message: string) =>
    out.push({ file: rel, line: lineOf(index), message });
  for (const m of text.matchAll(DROPPED)) {
    add(m.index, "@elias4044/ssp-node is not a dependency; requests go through net.ts");
  }
  for (const m of text.matchAll(/(^|[^\w.$])fetch\(|globalThis\.fetch\b/g)) {
    if (!TRANSPORT.test(rel))
      add(m.index, "fetch is called outside the provider's budgeted transport (net.ts)");
  }
  for (const m of text.matchAll(/from\s*["'](node:)?(http|https|http2|net|tls|undici)["']/g)) {
    if (!NETWORK_MODULE_ALLOWED.has(rel) && !rel.startsWith("http/"))
      add(m.index, `${m[2]} is imported outside the inbound servers; requests go through net.ts`);
  }
  return out;
}

/** The one module that creates files and directories for the user. */
const FILE_WRITER = "core/private-files.ts";
/**
 * Writers that do not touch user state: the fixture promotion tool moves reviewed
 * captures into the repository's test/fixtures, which are ordinary project files.
 */
const FILE_WRITE_ALLOWED = new Set(["providers/schoolsoft/capture/promote.ts"]);
/** node:fs functions that create a file or a directory (sync, callback and promise forms). */
const FS_CREATES = new Set(
  [
    "writeFile",
    "appendFile",
    "mkdir",
    "mkdtemp",
    "copyFile",
    "cp",
    "open",
    "symlink",
    "link",
  ].flatMap((name) => [name, `${name}Sync`]),
);
FS_CREATES.add("createWriteStream");

/**
 * Every state, config, cache and log write goes through core/private-files.ts, so a new
 * writer cannot forget the modes. Reading functions may be imported anywhere, by name.
 */
function checkFileWrites(rel: string, text: string): Violation[] {
  const out: Violation[] = [];
  if (rel === FILE_WRITER || FILE_WRITE_ALLOWED.has(rel)) return out;
  const lineOf = (index: number) => text.slice(0, index).split("\n").length;
  const add = (index: number, message: string) =>
    out.push({ file: rel, line: lineOf(index), message });
  for (const m of text.matchAll(
    /import\s+(type\s+)?([^;]*?)\s*from\s*["'](?:node:)?fs(?:\/promises)?["']/g,
  )) {
    if (m[1]) continue; // types create nothing
    const named = /\{([^}]*)\}/.exec(m[2]);
    const whole = m[2]
      .replace(/\{[^}]*\}/, "")
      .replace(/,/g, "")
      .trim();
    if (whole)
      add(
        m.index,
        "node:fs is imported as a whole; import reading functions by name and create files through core/private-files.ts",
      );
    for (const name of (named?.[1] ?? "").split(",")) {
      const imported = name
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)[0];
      if (FS_CREATES.has(imported))
        add(
          m.index,
          `${imported} creates files outside core/private-files.ts; use its helpers (0700 directories, 0600 files)`,
        );
    }
  }
  for (const m of text.matchAll(/\bimport\s*\(\s*["'](?:node:)?fs(?:\/promises)?["']\s*\)/g))
    add(m.index, "node:fs is imported dynamically; create files through core/private-files.ts");
  return out;
}

/**
 * The typed client (src/client) ships to apps and browsers: it may import Zod and its own
 * files, nothing else, and nothing else imports it (it is reached only as a package export).
 * Whole text, so multi-line and dynamic imports count too.
 */
function checkClient(rel: string, text: string, src: string, file: string): Violation[] {
  const out: Violation[] = [];
  const lineOf = (index: number) => text.slice(0, index).split("\n").length;
  const inClient = rel.startsWith("client/");
  for (const m of text.matchAll(
    /(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|(?:^|\n)\s*import\s*["']([^"']+)["']/g,
  )) {
    const spec = m[1] ?? m[2] ?? m[3];
    const at = m.index + m[0].length - m[0].trimStart().length;
    const target = spec.startsWith(".")
      ? relative(src, resolve(dirname(file), spec))
          .split("\\")
          .join("/")
      : undefined;
    if (inClient && spec !== "zod" && !target?.startsWith("client/"))
      out.push({
        file: rel,
        line: lineOf(at),
        message: `the typed client may import only zod and its own files, not ${spec}`,
      });
    if (!inClient && target?.startsWith("client/"))
      out.push({
        file: rel,
        line: lineOf(at),
        message: `${target} is the typed client; nothing in the package imports it`,
      });
  }
  return out;
}

const APP_SPECIFIER =
  /(?:\bfrom\s*|\brequire\s*\(\s*)["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']/g;

/**
 * The app's one allowed import from the root package is the typed client. A relative
 * specifier is judged by where it actually resolves (path.posix against a virtual
 * `/packages/app` root), not by counting `..` segments: only leaving `/packages/app`
 * reaches the root package's own `src/` (or anything else outside the workspace).
 */
export function checkAppImports(rel: string, text: string): Violation[] {
  const out: Violation[] = [];
  const dir = posix.dirname(rel);
  for (const m of text.matchAll(APP_SPECIFIER)) {
    const spec = m[1] ?? m[2] ?? m[3];
    if (!spec) continue;
    const rootPackage =
      spec === "schoolsoft-agent" ||
      (spec.startsWith("schoolsoft-agent/") && spec !== "schoolsoft-agent/client");
    const leavesWorkspace =
      spec.startsWith(".") &&
      !posix.resolve("/packages/app", dir, spec).startsWith("/packages/app/");
    if (rootPackage || leavesWorkspace) {
      out.push({
        file: `packages/app/${rel}`,
        line: text.slice(0, m.index).split("\n").length,
        message: `the app imports only schoolsoft-agent/client, not ${spec}`,
      });
    }
  }
  return out;
}

export function checkBoundaries(root: string): Violation[] {
  const src = join(root, "src");
  const violations: Violation[] = [];
  for (const file of walk(src)) {
    const rel = relative(src, file).split("\\").join("/");
    const layer = rel.split("/")[0];
    const source = readFileSync(file, "utf8");
    violations.push(...checkOutbound(rel, source));
    violations.push(...checkClient(rel, source, src, file));
    violations.push(...checkFileWrites(rel, source));
    const lines = source.split("\n");
    lines.forEach((text, i) => {
      const m = /^\s*(?:import|export)\s[^"']*["']([^"']+)["']/.exec(text);
      const line = i + 1;
      if (layer === "core" && /\bprocess\.env\b/.test(text)) {
        violations.push({ file: rel, line, message: "core must not read process.env" });
      }
      if (!m) return;
      const spec = m[1];
      if (
        spec === "playwright" &&
        !/^core\/browser\/(playwright|install)\.ts$/.test(rel) &&
        !text.trimStart().startsWith("import type ")
      ) {
        violations.push({
          file: rel,
          line,
          message:
            "playwright is optional: import it only in core/browser/playwright.ts or install.ts (dynamically)",
        });
      }
      if (
        spec === "playwright" &&
        /^core\/browser\/(playwright|install)\.ts$/.test(rel) &&
        /^\s*import\s+(?!type)/.test(text)
      ) {
        violations.push({
          file: rel,
          line,
          message: "playwright must be imported dynamically (await import), not statically",
        });
      }
      if (layer === "providers" && spec.startsWith(".")) {
        const target = relative(src, resolve(dirname(file), spec))
          .split("\\")
          .join("/");
        if (target === "core/index.js" || target === "core/wiring.js") {
          violations.push({
            file: rel,
            line,
            message: `provider must import core modules directly, not ${target} (cycle)`,
          });
        }
        if (/^(mcp|cli|http|shared)\//.test(target)) {
          violations.push({ file: rel, line, message: `provider imports adapter ${target}` });
        }
      }
      if (layer === "core") {
        if (spec.startsWith(".")) {
          const target = relative(src, resolve(dirname(file), spec))
            .split("\\")
            .join("/");
          if (target.startsWith("providers/") && rel !== "core/wiring.ts") {
            violations.push({
              file: rel,
              line,
              message: `core imports a provider (${target}); only core/wiring.ts may`,
            });
          }
        }
        if (spec === "node:process" || spec === "process") {
          violations.push({ file: rel, line, message: "core must not import node:process" });
        }
        if (spec.startsWith(".")) {
          const target = relative(src, resolve(dirname(file), spec))
            .split("\\")
            .join("/");
          if (/^(mcp|cli|http)\//.test(target)) {
            violations.push({ file: rel, line, message: `core imports adapter ${target}` });
          }
        }
      } else if (["mcp", "cli", "http", "shared"].includes(layer) && spec.startsWith(".")) {
        const target = relative(src, resolve(dirname(file), spec))
          .split("\\")
          .join("/");
        if (target.startsWith("core/") && target !== "core/index.js") {
          violations.push({
            file: rel,
            line,
            message: `adapter must import core via core/index.js, not ${target}`,
          });
        }
        if (target.startsWith("providers/")) {
          violations.push({
            file: rel,
            line,
            message: `adapter ${layer} imports a provider (${target}); use the core surface`,
          });
        }
        const other = ["mcp", "cli", "http"].filter((l) => l !== layer);
        if (other.some((l) => target.startsWith(l + "/"))) {
          violations.push({
            file: rel,
            line,
            message: `adapter ${layer} imports sibling adapter ${target}`,
          });
        }
      }
    });
  }
  const appRoot = join(root, "packages/app");
  for (const dir of ["app", "src"]) {
    const appDir = join(appRoot, dir);
    if (!existsSync(appDir)) continue;
    for (const file of walk(appDir, [], [".ts", ".tsx"])) {
      const rel = relative(appRoot, file).split("\\").join("/");
      violations.push(...checkAppImports(rel, readFileSync(file, "utf8")));
    }
  }
  return violations;
}

if (process.argv[1] && /check-boundaries\.(ts|js)$/.test(process.argv[1])) {
  const v = checkBoundaries(process.cwd());
  for (const x of v) console.error(`${x.file}:${x.line}: ${x.message}`);
  console.log(v.length === 0 ? "boundaries: OK" : `boundaries: ${v.length} violation(s)`);
  process.exit(v.length === 0 ? 0 : 1);
}
