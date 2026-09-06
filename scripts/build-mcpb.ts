/**
 * Stage the Claude Desktop bundle directory (dist/mcpb): manifest,
 * server launcher, compiled dist, production node_modules. `make mcpb`
 * then runs `mcpb pack` on it; `make mcpb-stage` only stages (CI).
 */
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

export function stageMcpb(root: string): string {
  const out = join(root, "dist", "mcpb");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, "server"), { recursive: true });
  const manifest = JSON.parse(readFileSync(join(root, "plugins", "mcpb", "manifest.json"), "utf8"));
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  manifest.version = pkg.version;
  writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2));
  // Every runtime layer the server imports; the hosts E2E launches this bundle and fails if one is missing.
  for (const layer of ["core", "providers", "mcp", "shared"]) {
    cpSync(join(root, "dist", layer), join(out, "server", "dist", layer), { recursive: true });
  }
  writeFileSync(join(out, "server", "index.js"), 'import "./dist/mcp/index.js";\n');
  writeFileSync(
    join(out, "server", "package.json"),
    JSON.stringify(
      {
        name: pkg.name,
        version: pkg.version,
        type: "module",
        private: true,
        dependencies: pkg.dependencies,
      },
      null,
      2,
    ),
  );
  cpSync(join(root, "package-lock.json"), join(out, "server", "package-lock.json"));
  execSync("npm ci --omit=dev --omit=optional --ignore-scripts --no-audit --no-fund", {
    cwd: join(out, "server"),
    stdio: "inherit",
  });
  for (const f of ["LICENSE", "README.md"])
    if (existsSync(join(root, f))) cpSync(join(root, f), join(out, f));
  return out;
}

if (process.argv[1] && /build-mcpb\.(ts|js)$/.test(process.argv[1])) {
  console.log("staged", stageMcpb(process.cwd()));
}
