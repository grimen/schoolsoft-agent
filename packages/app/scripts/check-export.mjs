// Fails when development-only code reaches a production web export (spec: Production safety).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] ?? "dist-web";
const FORBIDDEN = ["schoolsoft-app-dev-connect", "schoolsoft-reference", "dev-proxy"];
const files = [];
(function walk(d) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(js|html)$/.test(p)) files.push(p);
  }
})(dir);
if (files.length === 0) {
  console.error(`no .js or .html files in ${dir}; run the export first`);
  process.exit(1);
}
const found = [];
for (const f of files) {
  const text = readFileSync(f, "utf8");
  for (const s of FORBIDDEN) if (text.includes(s)) found.push(`${f}: ${s}`);
}
if (found.length) {
  console.error("development code in the production export:\n" + found.join("\n"));
  process.exit(1);
}
console.log(`production export clean (${files.length} files)`);
