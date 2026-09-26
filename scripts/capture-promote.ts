/**
 * `make capture-promote`: move the reviewed files from the capture
 * directory into test/fixtures/, but only when none of them still looks
 * like personal data (src/providers/schoolsoft/capture/promote.ts). Extend
 * the check with names of your own in .capture-denylist (gitignored, one
 * per line). Offline; commits nothing.
 */
import { resolve } from "node:path";
import { promoteCaptures } from "../src/providers/schoolsoft/capture/promote.js";

process.exit(
  promoteCaptures(
    {
      captureDir: resolve(process.env.SCHOOLSOFT_CAPTURE_DIR ?? ".captures"),
      repoRoot: process.cwd(),
      denylistFile: resolve(".capture-denylist"),
    },
    { out: (l) => console.log(l), err: (l) => console.error(l) },
  ),
);
