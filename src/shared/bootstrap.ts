/**
 * Shared adapter bootstrap: turn env + config file into an OperationContext.
 * Lives outside core because it touches the filesystem layout of the
 * config file and process-level inputs.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  type Config,
  type ConfigSource,
  type OperationContext,
  CONFIG_FORMAT,
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
 * Parse and migrate config.json. A file from a newer build throws
 * NewerFormatError; bad JSON or a malformed version is the usual
 * "Could not parse" error naming the file.
 */
function readConfigDocument(file: string): ConfigSource {
  return loadVersioned<ConfigSource, never>(
    CONFIG_FORMAT,
    file,
    () => JSON.parse(readFileSync(file, "utf8")),
    (e) => {
      throw new Error(`Could not parse ${file}: ${(e as Error).message}`, { cause: e });
    },
  );
}

/** Raw contents of config.json (no configDir injected), {} if absent. */
export function readConfigFile(configDir: string): ConfigSource {
  const file = join(configDir, CONFIG_FILE);
  if (!existsSync(file)) return {};
  return readConfigDocument(file);
}

/** Write config.json (0600) with the current format version and return its path. */
export function writeConfigFile(configDir: string, config: ConfigSource): string {
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  const file = join(configDir, CONFIG_FILE);
  writeFileSync(file, JSON.stringify(writeVersioned(CONFIG_FORMAT, config), null, 2) + "\n", {
    mode: 0o600,
  });
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

export function fileSource(configDir: string): ConfigSource {
  const file = join(configDir, CONFIG_FILE);
  if (!existsSync(file)) return {};
  return { ...readConfigDocument(file), configDir };
}

/** Resolve the Config with precedence overrides > env > file > defaults. */
export function loadConfig(inputs: BootstrapInputs): Config {
  const configDir = configDirFrom(inputs);
  return resolveConfig(
    [inputs.overrides ?? {}, envSource(inputs.env), fileSource(configDir), { configDir }],
    { home: inputs.home, platform: inputs.platform, env: inputs.env },
  );
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
