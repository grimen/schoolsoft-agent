/**
 * `make capture-promote` (scripts/capture-promote.ts): move reviewed
 * captures from the gitignored capture directory into test/fixtures/.
 * All or nothing: every file listed in the capture's manifest is scanned
 * first (scan.ts, with the maintainer's local denylist and the names the
 * capture knew), and one finding anywhere means nothing moves. Moving is
 * still not committing: the maintainer reads `git diff` before a commit.
 */
import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { EXIT_CODE_BY_KIND } from "../../../core/errors/index.js";
import { HASHED_NAMES, MANIFEST, type CaptureIo } from "./capture.js";
import { parseDenylist, scanForPersonalData, type Denylist, type Finding } from "./scan.js";

export interface PromoteOptions {
  captureDir: string;
  repoRoot: string;
  /** The maintainer's own denylist (gitignored); missing is fine. */
  denylistFile: string;
}

interface ManifestEntry {
  file: string;
  fixture: string;
}

const FIXTURES = "test/fixtures/";

function readJson<T>(file: string): T | null {
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : null;
}

export function promoteCaptures(o: PromoteOptions, io: CaptureIo): number {
  const manifest = readJson<{ files: ManifestEntry[] }>(join(o.captureDir, MANIFEST));
  if (!manifest || manifest.files.length === 0) {
    io.err(`Nothing to promote in ${o.captureDir}.`);
    io.err("Next: run make capture with a saved session first.");
    return EXIT_CODE_BY_KIND.input;
  }
  const deny: Denylist = {
    words: existsSync(o.denylistFile) ? parseDenylist(readFileSync(o.denylistFile, "utf8")) : [],
    hashed: readJson<Denylist["hashed"]>(join(o.captureDir, HASHED_NAMES)) ?? undefined,
  };

  const problems: { file: string; findings: Finding[]; reason?: string }[] = [];
  for (const { file, fixture } of manifest.files) {
    const source = join(o.captureDir, file);
    const target = normalize(fixture);
    if (!target.startsWith(FIXTURES) || target.includes("..") || file.includes("/")) {
      problems.push({ file, findings: [], reason: "destination is not under test/fixtures/" });
    } else if (!existsSync(source)) {
      problems.push({ file, findings: [], reason: "file is missing (already promoted?)" });
    } else {
      const findings = scanForPersonalData(readFileSync(source, "utf8"), deny);
      if (findings.length) problems.push({ file, findings });
    }
  }

  if (problems.length) {
    for (const p of problems) {
      const where = p.findings.map((f) => `${f.rule} on line ${f.line}`).join(", ");
      io.err(`${p.file}: ${p.reason ?? where}`);
    }
    io.err("Nothing was moved.");
    io.err(
      "Next: edit the files in the capture directory (or re-run make capture), then promote again. " +
        "Findings show the rule and line only, never the text.",
    );
    return EXIT_CODE_BY_KIND.input;
  }

  for (const { file, fixture } of manifest.files) {
    const target = join(o.repoRoot, fixture);
    mkdirSync(dirname(target), { recursive: true });
    renameSync(join(o.captureDir, file), target);
    io.out(`${file} -> ${fixture}`);
  }
  io.out(
    "Next: read git diff for these files, run make format, and commit only what you have read yourself.",
  );
  return 0;
}
