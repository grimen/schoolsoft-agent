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
  createGuardianApi,
  createSessionManager,
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

/** Raw contents of config.json (no configDir injected), {} if absent. */
export function readConfigFile(configDir: string): ConfigSource {
  const file = join(configDir, CONFIG_FILE);
  if (!existsSync(file)) return {};
  return JSON.parse(readFileSync(file, "utf8")) as ConfigSource;
}

/** Write config.json (0600) and return its path. */
export function writeConfigFile(configDir: string, config: ConfigSource): string {
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  const file = join(configDir, CONFIG_FILE);
  writeFileSync(file, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  return file;
}

export function fileSource(configDir: string): ConfigSource {
  const file = join(configDir, CONFIG_FILE);
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as ConfigSource;
    return { ...parsed, configDir };
  } catch (e) {
    throw new Error(`Could not parse ${file}: ${e instanceof Error ? e.message : e}`, { cause: e });
  }
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
    if (!ctx) {
      const config = loadConfig(inputs);
      const manager = createSessionManager(config);
      ctx = {
        manager,
        api: createGuardianApi(manager),
        config,
        log: inputs.log ?? ((m) => console.error(m)),
      };
    }
    return ctx;
  };
}
