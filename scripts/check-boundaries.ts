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
 *     only a provider's net.ts imports ssp-node's `schoolsoftFetch`/`rawRequest` or calls `fetch`;
 *     nothing imports ssp-node's other request helpers or calls a SchoolsoftClient method that sends
 *     (`verifySession`, `getNews`, ...); only the inbound servers import node:http(s)/net/tls/undici
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, dirname, resolve } from "node:path";

export interface Violation {
  file: string;
  line: number;
  message: string;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** Where a provider's one budgeted transport lives. */
const TRANSPORT = /^providers\/[^/]+\/net\.ts$/;
/** Inbound servers only: the OAuth callback listener and the connector's own HTTP server. */
const NETWORK_MODULE_ALLOWED = new Set(["core/auth/callback-server.ts"]);
/** ssp-node exports that send a request themselves, bypassing any injected transport. */
const SSP_REQUEST_HELPERS = new Set([
  "simpleLogin",
  "startMobileFlow",
  "mobileLogin",
  "completeMobileFlow",
  "mobileRefreshToken",
  "mobileGetSession",
  "fetchMobileSession",
  "verifySession",
  "exchangeCodeForToken",
  "getSession",
  "getSchools",
  "getLunch",
  "getSchedule",
  "getAssignmentsForWeek",
  "getAssignment",
  "getSubjects",
  "getSubject",
  "getNews",
  "getStartpage",
  "getClassStudents",
]);
/** SchoolsoftClient methods that send a request with ssp-node's own HTTP. */
const CLIENT_SENDS =
  /\bclient\s*\.\s*(login|startMobileFlow|completeMobileFlow|mobileLogin|mobileRefresh|mobileExchangeSession|fetchMobileSessionInfo|getSchools|getSession|getLunch|getSchedule|getAssignmentsForWeek|getAssignment|getSubjects|getSubject|getNews|getStartpage|getClassStudents)\s*\(/;

/** The outbound rules for one file (whole text, so multi-line imports count too). */
function checkOutbound(rel: string, text: string): Violation[] {
  const out: Violation[] = [];
  const lineOf = (index: number) => text.slice(0, index).split("\n").length;
  const add = (index: number, message: string) =>
    out.push({ file: rel, line: lineOf(index), message });
  for (const m of text.matchAll(
    /import\s+(type\s+)?\{([^}]*)\}\s*from\s*["']@elias4044\/ssp-node["']/g,
  )) {
    if (m[1]) continue; // types send nothing
    const names = m[2]
      .split(",")
      .map(
        (n) =>
          n
            .trim()
            .replace(/^type\s+/, "")
            .split(/\s+as\s+/)[0],
      )
      .filter(Boolean);
    for (const name of names) {
      if ((name === "schoolsoftFetch" || name === "rawRequest") && !TRANSPORT.test(rel))
        add(m.index, `${name} is imported outside the provider's budgeted transport (net.ts)`);
      if (SSP_REQUEST_HELPERS.has(name))
        add(m.index, `ssp-node's ${name} sends requests around the request budget`);
    }
  }
  for (const m of text.matchAll(/(^|[^\w.$])fetch\(|globalThis\.fetch\b/g)) {
    if (!TRANSPORT.test(rel))
      add(m.index, "fetch is called outside the provider's budgeted transport (net.ts)");
  }
  for (const m of text.matchAll(new RegExp(CLIENT_SENDS, "g"))) {
    add(m.index, `SchoolsoftClient.${m[1]} sends requests around the request budget`);
  }
  for (const m of text.matchAll(/\.verifySession\s*\(/g)) {
    add(m.index, "verifySession sends requests around the request budget");
  }
  for (const m of text.matchAll(/from\s*["'](node:)?(http|https|http2|net|tls|undici)["']/g)) {
    if (!NETWORK_MODULE_ALLOWED.has(rel) && !rel.startsWith("http/"))
      add(m.index, `${m[2]} is imported outside the inbound servers; requests go through net.ts`);
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
  return violations;
}

if (process.argv[1] && /check-boundaries\.(ts|js)$/.test(process.argv[1])) {
  const v = checkBoundaries(process.cwd());
  for (const x of v) console.error(`${x.file}:${x.line}: ${x.message}`);
  console.log(v.length === 0 ? "boundaries: OK" : `boundaries: ${v.length} violation(s)`);
  process.exit(v.length === 0 ? 0 : 1);
}
