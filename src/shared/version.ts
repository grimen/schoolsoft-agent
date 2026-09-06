import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// Resolved relative to dist/mcp/version.js at runtime and src/mcp/version.ts under tsx.
const pkg = require("../../package.json") as { version: string };

export const PACKAGE_VERSION: string = pkg.version;
