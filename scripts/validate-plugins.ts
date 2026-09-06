/**
 * Validate host packaging. Structural checks always run; external
 * validators (`claude plugin validate`, `skills-ref validate`) run when
 * available on PATH and are reported, never required.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface Problem {
  file: string;
  message: string;
}

const json = (p: string) => JSON.parse(readFileSync(p, "utf8")) as Record<string, any>;

export function validatePlugins(root: string): Problem[] {
  const problems: Problem[] = [];
  const need = (cond: unknown, file: string, message: string) => {
    if (!cond) problems.push({ file, message });
  };
  const pkg = json(join(root, "package.json"));

  const mp = "plugins/claude/.claude-plugin/marketplace.json";
  const m = json(join(root, mp));
  need(
    m.name && m.owner?.name && Array.isArray(m.plugins),
    mp,
    "name, owner.name, plugins[] required",
  );
  need(
    m.plugins
      ?.map((p: any) => p.name)
      .sort()
      .join(",") === "schoolsoft-mcp,schoolsoft-skill",
    mp,
    "must list exactly schoolsoft-mcp and schoolsoft-skill",
  );
  for (const p of m.plugins ?? []) {
    need(
      typeof p.source === "string" && existsSync(join(root, "plugins/claude", p.source)),
      mp,
      `source ${p.source} must exist`,
    );
    const pj = join(root, "plugins/claude", p.source, ".claude-plugin/plugin.json");
    need(existsSync(pj), pj, "plugin.json missing");
    if (existsSync(pj)) {
      const plugin = json(pj);
      need(plugin.name === p.name, pj, "name must match marketplace entry");
      need(plugin.version === pkg.version, pj, `version must equal package.json (${pkg.version})`);
    }
  }
  const mcp = "plugins/claude/schoolsoft-mcp/.mcp.json";
  const mc = json(join(root, mcp));
  const s = mc.mcpServers?.schoolsoft;
  need(s?.command === "npx", mcp, "command must be npx");
  need(
    JSON.stringify(s?.args) ===
      JSON.stringify(["-y", "-p", `schoolsoft-agent@${pkg.version}`, "schoolsoft-agent-mcp"]),
    mcp,
    `args must pin schoolsoft-agent@${pkg.version}`,
  );
  need(
    existsSync(join(root, "plugins/claude/schoolsoft-skill/skills/schoolsoft/SKILL.md")),
    "plugins/claude/schoolsoft-skill",
    "skills/schoolsoft/SKILL.md missing — run make skills",
  );

  const mb = "plugins/mcpb/manifest.json";
  const b = json(join(root, mb));
  need(
    b.manifest_version && b.name && b.version === pkg.version && b.description && b.author?.name,
    mb,
    "manifest_version, name, version(=package), description, author.name required",
  );
  need(
    b.server?.type === "node" && b.server?.entry_point && b.server?.mcp_config?.command,
    mb,
    "server.type/entry_point/mcp_config required",
  );
  need(b.user_config?.school?.required === true, mb, "user_config.school must be required");

  const oc = json(join(root, "plugins/opencode/opencode.json"));
  need(
    oc.mcp?.schoolsoft?.type === "local" && Array.isArray(oc.mcp.schoolsoft.command),
    "plugins/opencode/opencode.json",
    "mcp.schoolsoft local command[] required",
  );
  for (const host of ["opencode", "openclaw", "hermes"]) {
    const f = `plugins/${host}/skill-metadata.json`;
    const d = json(join(root, f));
    need(d[host] && typeof d[host] === "object", f, `top-level "${host}" object required`);
  }
  need(
    Array.isArray(json(join(root, "plugins/pi/pi.json")).skills),
    "plugins/pi/pi.json",
    "skills[] required",
  );
  need(
    JSON.stringify(pkg.pi?.skills) ===
      JSON.stringify(json(join(root, "plugins/pi/pi.json")).skills),
    "package.json",
    "pi.skills must equal plugins/pi/pi.json",
  );
  return problems;
}

/** Runs external validators when installed; a failure from an installed validator is a problem. */
export function externalValidators(root: string): { notes: string[]; problems: Problem[] } {
  const notes: string[] = [];
  const problems: Problem[] = [];
  const tryRun = (cmd: string, args: string[], file: string) => {
    const r = spawnSync(cmd, args, { cwd: root, encoding: "utf8" });
    if (r.error) {
      notes.push(`${cmd}: not available (skipped)`);
      return;
    }
    notes.push(`${cmd} ${args.join(" ")}: exit ${r.status}`);
    if (r.status !== 0)
      problems.push({ file, message: `${cmd} ${args.join(" ")} failed:\n${r.stdout}${r.stderr}` });
  };
  tryRun(
    "claude",
    ["plugin", "validate", "plugins/claude"],
    "plugins/claude/.claude-plugin/marketplace.json",
  );
  for (const p of ["schoolsoft-mcp", "schoolsoft-skill"])
    tryRun("claude", ["plugin", "validate", `plugins/claude/${p}`], `plugins/claude/${p}`);
  tryRun("skills-ref", ["validate", "skills/schoolsoft"], "skills/schoolsoft");
  return { notes, problems };
}

if (process.argv[1] && /validate-plugins\.(ts|js)$/.test(process.argv[1])) {
  const ext = externalValidators(process.cwd());
  const problems = [...validatePlugins(process.cwd()), ...ext.problems];
  for (const n of ext.notes) console.log(n);
  for (const p of problems) console.error(`${p.file}: ${p.message}`);
  console.log(problems.length ? `plugins: ${problems.length} problem(s)` : "plugins: OK");
  process.exit(problems.length ? 1 : 0);
}
