/**
 * `configure`: write config.json. Interactive (find the school by name)
 * when a prompt is available and no flags were given; otherwise
 * non-interactive via --school/--org-id. The school becomes the current
 * account; other schools already configured are kept with their settings.
 * The lookup and the write are shared with `setup` (the guided first run).
 */
import type { Command } from "commander";
import { join } from "node:path";
import {
  accountKey,
  accountSource,
  createRequestBudget,
  defaultConfigDir,
  envSource,
  getProvider,
  type AccountSettings,
  type RankedSchool,
} from "../../core/index.js";
import { writeConfigFile, readConfigFile } from "../../shared/bootstrap.js";
import type { CliDeps } from "../program.js";
import { CliExit } from "../program.js";
import { EXIT } from "../exit-codes.js";

type Globals = Record<string, string | undefined>;

/** The config directory: --config-dir, else SCHOOLSOFT_CONFIG_DIR, else the platform default. */
export function configDirOf(deps: CliDeps, g: Globals): string {
  return (
    g.configDir ||
    deps.env.SCHOOLSOFT_CONFIG_DIR ||
    defaultConfigDir(deps.home, deps.platform, deps.env)
  );
}

/** The provider id from a flag or the environment; undefined means the default. */
export function providerIdOf(deps: CliDeps, g: Globals): string | undefined {
  return g.provider ?? envSource(deps.env).provider;
}

/** Best matches in the provider's public school list (cached in schools.json). */
export async function findSchools(
  configDir: string,
  providerId: string | undefined,
  query: string,
  limit = 5,
): Promise<RankedSchool[]> {
  // The provider is known before the school is: env/flag, else the default.
  const provider = getProvider(providerId ?? "schoolsoft");
  // No session yet: a budget of the provider's defaults for this one command.
  const dir = provider.createSchoolDirectory(
    join(configDir, "schools.json"),
    createRequestBudget({ provider: provider.id, requestBudget: {} }),
  );
  return dir.find(query, limit);
}

/** Make the school the current account in config.json, keeping every other school's settings. */
export function saveSchool(
  configDir: string,
  providerId: string | undefined,
  school: string,
  orgId: string | undefined,
): { file: string; config: ReturnType<typeof accountSource> } {
  const existing = readConfigFile(configDir);
  // The entry starts from what this school already had, never from another school's settings.
  const account = accountKey(providerId, school);
  const entry: AccountSettings = {
    ...existing.accounts?.[account],
    ...(providerId ? { provider: providerId } : {}),
    school,
    ...(orgId ? { orgId } : {}),
  };
  const next = { ...existing, account, accounts: { ...existing.accounts, [account]: entry } };
  const file = writeConfigFile(configDir, next);
  return { file, config: accountSource(next) };
}

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
      const g = program.opts() as Globals;
      const configDir = configDirOf(deps, g);
      const providerId = providerIdOf(deps, g);

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
        const hits = await findSchools(configDir, providerId, query);
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

      const { file, config } = saveSchool(configDir, providerId, school, orgId);
      emit({ status: "configured", file, config });
    });
}
