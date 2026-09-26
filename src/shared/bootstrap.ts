/**
 * Shared adapter bootstrap: turn env + config file into an OperationContext.
 * Lives outside core because it touches the filesystem layout of the
 * config file and process-level inputs.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  type AccountSelection,
  type Config,
  type ConfigDocument,
  type ConfigSource,
  type OperationContext,
  CONFIG_FORMAT,
  accountSource,
  foldAccountSettings,
  loadVersioned,
  storedVersion,
  writeVersioned,
  createPortals,
  createSessionManager,
  resolveProvider,
  defaultConfigDir,
  envSource,
  resolveConfig,
} from "../core/index.js";

export interface BootstrapInputs {
  env: Record<string, string | undefined>;
  home: string;
  platform: NodeJS.Platform;
  /** Highest-precedence overrides (CLI flags). */
  overrides?: ConfigSource;
  log?: (message: string) => void;
}

export const CONFIG_FILE = "config.json";

export function configDirFrom(inputs: BootstrapInputs): string {
  return (
    inputs.overrides?.configDir ||
    inputs.env.SCHOOLSOFT_CONFIG_DIR ||
    defaultConfigDir(inputs.home, inputs.platform, inputs.env)
  );
}

/**
 * Parse and migrate config.json, with top-level account settings folded
 * into their account (they stay valid settings in every version). A file
 * from a newer build throws NewerFormatError; bad JSON or a malformed
 * version is the usual "Could not parse" error naming the file.
 */
function readConfigDocument(file: string): ConfigDocument {
  return foldAccountSettings(
    loadVersioned<ConfigDocument, never>(
      CONFIG_FORMAT,
      file,
      () => JSON.parse(readFileSync(file, "utf8")),
      (e) => {
        throw new Error(`Could not parse ${file}: ${(e as Error).message}`, { cause: e });
      },
    ),
  );
}

/** Contents of config.json in the current shape (no configDir injected), {} if absent. */
export function readConfigFile(configDir: string): ConfigDocument {
  const file = join(configDir, CONFIG_FILE);
  if (!existsSync(file)) return {};
  return readConfigDocument(file);
}

/** Write config.json (0600) in the current format and return its path. */
export function writeConfigFile(configDir: string, config: ConfigDocument): string {
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  const file = join(configDir, CONFIG_FILE);
  const doc = writeVersioned(CONFIG_FORMAT, foldAccountSettings(config));
  writeFileSync(file, JSON.stringify(doc, null, 2) + "\n", { mode: 0o600 });
  return file;
}

/** The format version of config.json (0 before versions existed); null when absent or unreadable. */
export function configFileVersion(configDir: string): number | null {
  const file = join(configDir, CONFIG_FILE);
  if (!existsSync(file)) return null;
  try {
    return storedVersion(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return null;
  }
}

/** config.json's settings for the selected account (default: the file's current account). */
export function fileSource(configDir: string, selection: AccountSelection = {}): ConfigSource {
  const file = join(configDir, CONFIG_FILE);
  if (!existsSync(file)) return {};
  return { ...accountSource(readConfigDocument(file), selection), configDir };
}

/**
 * Resolve the Config with precedence overrides > env > file > defaults. A
 * school chosen by a flag or the environment picks that account's settings
 * from the file, never the configured school's.
 */
export function loadConfig(inputs: BootstrapInputs): Config {
  const configDir = configDirFrom(inputs);
  const overrides = inputs.overrides ?? {};
  const env = envSource(inputs.env);
  const selection: AccountSelection = {
    provider: overrides.provider || env.provider,
    school: overrides.school || env.school,
  };
  return resolveConfig([overrides, env, fileSource(configDir, selection), { configDir }], {
    home: inputs.home,
    platform: inputs.platform,
    env: inputs.env,
  });
}

/**
 * Returns a lazy, memoised context factory. Config errors surface on first
 * use so a misconfigured MCP server still starts and reports cleanly.
 */
export function loadContext(inputs: BootstrapInputs): () => OperationContext {
  let ctx: OperationContext | null = null;
  return () => {
    if (ctx) return ctx;
    const config = loadConfig(inputs);
    const manager = createSessionManager(config, { pid: process.pid });
    const built: OperationContext = {
      manager,
      ...createPortals(manager, { engine: config.browser }),
      provider: resolveProvider(config),
      config,
      log: inputs.log ?? ((m) => console.error(m)),
    };
    ctx = built;
    return built;
  };
}
