/**
 * Build per-host skill folders from the single source in skills/schoolsoft:
 *   dist/skills/<host>/schoolsoft/   with plugins/<host>/skill-metadata.json
 *   merged into the frontmatter `metadata:` block (body untouched), and
 *   plugins/claude/schoolsoft-skill/skills/schoolsoft/ (committed copy).
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const HOSTS = ["claude", "opencode", "openclaw", "hermes", "pi"] as const;
export type Host = (typeof HOSTS)[number];

export function mergeFrontmatter(skillMd: string, extraMetadata: Record<string, unknown>): string {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(skillMd);
  if (!m) throw new Error("SKILL.md has no frontmatter");
  const [, fm, body] = m;
  const lines = fm.split("\n");
  const idx = lines.findIndex((l) => /^metadata:\s*$/.test(l));
  const extra = renderYaml(extraMetadata, 2);
  let out: string[];
  if (idx === -1) {
    out = [...lines, "metadata:", ...extra];
  } else {
    // append after existing metadata block (its indented lines)
    let end = idx + 1;
    while (end < lines.length && /^\s+/.test(lines[end])) end++;
    out = [...lines.slice(0, end), ...extra, ...lines.slice(end)];
  }
  return `---\n${out.join("\n")}\n---\n${body}`;
}

function renderYaml(value: unknown, indent: number): string[] {
  const pad = " ".repeat(indent);
  if (Array.isArray(value)) {
    return value.map((v) =>
      typeof v === "object" && v !== null
        ? [`${pad}-`, ...renderYaml(v, indent + 2).map((l) => l.replace(/^ {2}/, ""))].join("\n")
        : `${pad}- ${scalar(v)}`,
    );
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
      v && typeof v === "object"
        ? [`${pad}${k}:`, ...renderYaml(v, indent + 2)]
        : [`${pad}${k}: ${scalar(v)}`],
    );
  }
  return [`${pad}${scalar(value)}`];
}

function scalar(v: unknown): string {
  if (typeof v === "string") return /[:#\[\]{}]|^\s|\s$/.test(v) ? JSON.stringify(v) : v;
  return JSON.stringify(v);
}

export function buildSkills(root: string): string[] {
  const src = join(root, "skills", "schoolsoft");
  const skillMd = readFileSync(join(src, "SKILL.md"), "utf8");
  const written: string[] = [];
  const targets: Array<[Host, string]> = HOSTS.map((h) => [
    h,
    join(root, "dist", "skills", h, "schoolsoft"),
  ]);
  targets.push([
    "claude",
    join(root, "plugins", "claude", "schoolsoft-skill", "skills", "schoolsoft"),
  ]);
  for (const [host, dest] of targets) {
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(dest, { recursive: true });
    cpSync(src, dest, { recursive: true });
    const metaFile = join(root, "plugins", host, "skill-metadata.json");
    const md = existsSync(metaFile)
      ? mergeFrontmatter(skillMd, JSON.parse(readFileSync(metaFile, "utf8")))
      : skillMd;
    writeFileSync(join(dest, "SKILL.md"), md);
    written.push(dest);
  }
  return written;
}

if (process.argv[1] && /gen-skills\.(ts|js)$/.test(process.argv[1])) {
  for (const d of buildSkills(process.cwd())) console.log("built", d);
}
