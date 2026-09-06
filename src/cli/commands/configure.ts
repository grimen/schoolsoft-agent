/**
 * `configure`: write config.json. Interactive (find the school by name)
 * when a prompt is available and no flags were given; otherwise
 * non-interactive via --school/--org-id.
 */
import type { Command } from "commander";
import { join } from "node:path";
import { SchoolDirectory, defaultConfigDir } from "../../core/index.js";
import { writeConfigFile, readConfigFile } from "../../shared/bootstrap.js";
import type { CliDeps } from "../program.js";
import { CliExit } from "../program.js";
import { EXIT } from "../exit-codes.js";

export function registerConfigure(
  program: Command,
  deps: CliDeps,
  emit: (d: unknown) => void,
): void {
  program
    .command("configure")
    .description("Write the config file (interactive school lookup, or --school/--org-id)")
    .option("--query <name>", "School name to look up (non-interactive)")
    .action(async (opts: { query?: string }) => {
      const g = program.opts() as Record<string, string | undefined>;
      const configDir =
        g.configDir ||
        deps.env.SCHOOLSOFT_CONFIG_DIR ||
        defaultConfigDir(deps.home, deps.platform, deps.env);
      const existing = readConfigFile(configDir);

      let school = g.school;
      let orgId = g.orgId;
      if (!school) {
        const query =
          opts.query ??
          (deps.prompt ? await deps.prompt("School name (e.g. Rösjöskolan): ") : undefined);
        if (!query) {
          throw new CliExit(
            EXIT.ERROR,
            "Nothing to configure: pass --school <slug> [--org-id <id>] or --query <name>.",
          );
        }
        const dir = new SchoolDirectory({ cacheFile: join(configDir, "schools.json") });
        const hits = await dir.find(query, 5);
        if (hits.length === 0) throw new CliExit(EXIT.ERROR, `No school matched "${query}".`);
        let pick = hits[0];
        if (deps.prompt && hits.length > 1 && !opts.query) {
          deps.stderr(
            hits.map((h, i) => `${i + 1}. ${h.name} (${h.slug}, orgId ${h.orgId})`).join("\n"),
          );
          const answer = await deps.prompt(`Pick 1-${hits.length} [1]: `);
          const n = Number(answer || "1");
          if (!Number.isInteger(n) || n < 1 || n > hits.length)
            throw new CliExit(EXIT.ERROR, "Invalid choice.");
          pick = hits[n - 1];
        }
        school = pick.slug;
        orgId = String(pick.orgId);
      }

      const next = { ...existing, school, ...(orgId ? { orgId } : {}) };
      const file = writeConfigFile(configDir, next);
      emit({ status: "configured", file, config: next });
    });
}
