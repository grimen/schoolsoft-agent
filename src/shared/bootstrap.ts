/**
 * Shared adapter bootstrap: turn env + config file into an OperationContext.
 * Lives outside core because it touches the filesystem layout of the
 * config file and process-level inputs.
 */
import { existsSync, readFileSync } from "node:fs";
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

export function fileSource(configDir: string): ConfigSource {
  const file = join(configDir, CONFIG_FILE);
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as ConfigSource;
    return { ...parsed, configDir };
  } catch (e) {
    throw new Error(`Could not parse ${file}: ${e instanceof Error ? e.message : e}`);
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
