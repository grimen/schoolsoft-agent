/**
 * Configuration model and factories. Pure: nothing here reads the
 * environment or the filesystem — adapters gather `ConfigSource`s (flags,
 * env, config file) and pass them in, highest precedence first.
 */
import { join } from "node:path";
import {
  DEFAULT_CALLBACK_PORT,
  DEFAULT_CLIENT_ID_BY_USER_TYPE,
  DEFAULT_USER_TYPE,
  SCHOOLSOFT_USER_TYPES,
  type SchoolsoftUserType,
} from "./constants.js";
import { SessionManager } from "./session/session-manager.js";
import { FileSessionStore } from "./session/file-store.js";
import type { SessionStore } from "./session/store.js";
import { BankIdBrowserStrategy, type BankIdBrowserOptions } from "./auth/bankid-browser.js";
import { GuardianApi } from "./api/guardian.js";

export interface Config {
  /** School slug, e.g. "taby" from https://sms.schoolsoft.se/taby/... */
  school: string;
  orgId?: string;
  userType: SchoolsoftUserType;
  clientId: string;
  callbackPort: number;
  /** Directory of the encrypted session store. */
  stateDir: string;
  /** Directory of config.json and caches. */
  configDir: string;
}

/** A partial, untyped-ish config from one source (file, env, flags). */
export interface ConfigSource {
  school?: string;
  orgId?: string;
  userType?: string;
  clientId?: string;
  callbackPort?: number | string;
  stateDir?: string;
  configDir?: string;
}

export class NotConfiguredError extends Error {
  constructor(reason: string) {
    super(
      `SchoolSoft is not configured (${reason}). Run "schoolsoft-agent configure" ` +
        `or set SCHOOLSOFT_SCHOOL to your school slug (e.g. "taby").`,
    );
    this.name = "NotConfiguredError";
  }
}

/** Environment variable names (the only place they are spelled out). */
export const ENV = {
  school: "SCHOOLSOFT_SCHOOL",
  orgId: "SCHOOLSOFT_ORGID",
  userType: "SCHOOLSOFT_USER_TYPE",
  clientId: "SCHOOLSOFT_CLIENT_ID",
  callbackPort: "SCHOOLSOFT_CALLBACK_PORT",
  stateDir: "SCHOOLSOFT_STATE_DIR",
  configDir: "SCHOOLSOFT_CONFIG_DIR",
} as const;

/** Map SCHOOLSOFT_* variables to a ConfigSource (empty strings ignored). */
export function envSource(env: Record<string, string | undefined>): ConfigSource {
  const pick = (k: string) => (env[k] ? env[k] : undefined);
  return {
    school: pick(ENV.school),
    orgId: pick(ENV.orgId),
    userType: pick(ENV.userType),
    clientId: pick(ENV.clientId),
    callbackPort: pick(ENV.callbackPort),
    stateDir: pick(ENV.stateDir),
    configDir: pick(ENV.configDir),
  };
}

/** Platform config directory for this app. */
export function defaultConfigDir(
  home: string,
  platform: NodeJS.Platform,
  env: Record<string, string | undefined> = {},
): string {
  if (platform === "darwin") return join(home, "Library", "Application Support", "schoolsoft-agent");
  if (platform === "win32") return join(env.APPDATA ?? join(home, "AppData", "Roaming"), "schoolsoft-agent");
  return join(env.XDG_CONFIG_HOME ?? join(home, ".config"), "schoolsoft-agent");
}

function first<K extends keyof ConfigSource>(sources: ConfigSource[], key: K): ConfigSource[K] | undefined {
  for (const s of sources) {
    const v = s[key];
    if (v !== undefined && v !== "") return v;
  }
  return undefined;
}

/**
 * Resolve a Config from sources ordered by precedence (first wins).
 * Throws NotConfiguredError when no school is given.
 */
export function resolveConfig(
  sources: ConfigSource[],
  defaults: { home: string; platform: NodeJS.Platform; env?: Record<string, string | undefined> },
): Config {
  const school = first(sources, "school");
  if (!school) throw new NotConfiguredError("no school slug");

  const rawUserType = first(sources, "userType") ?? DEFAULT_USER_TYPE;
  if (!(SCHOOLSOFT_USER_TYPES as readonly string[]).includes(rawUserType)) {
    throw new Error(
      `Invalid userType "${rawUserType}". Expected one of: ${SCHOOLSOFT_USER_TYPES.join(", ")}`,
    );
  }
  const userType = rawUserType as SchoolsoftUserType;

  const rawPort = first(sources, "callbackPort");
  const callbackPort = rawPort === undefined ? DEFAULT_CALLBACK_PORT : Number(rawPort);
  if (!Number.isInteger(callbackPort) || callbackPort < 1 || callbackPort > 65535) {
    throw new Error(`Invalid callbackPort "${rawPort}"`);
  }

  const configDir =
    first(sources, "configDir") ?? defaultConfigDir(defaults.home, defaults.platform, defaults.env);
  return {
    school,
    orgId: first(sources, "orgId"),
    userType,
    clientId: first(sources, "clientId") ?? DEFAULT_CLIENT_ID_BY_USER_TYPE[userType],
    callbackPort,
    stateDir: first(sources, "stateDir") ?? join(configDir, "state"),
    configDir,
  };
}

export interface SessionDeps {
  store?: SessionStore;
  fetchImpl?: BankIdBrowserOptions["fetchImpl"];
  openBrowser?: BankIdBrowserOptions["openBrowser"];
}

/** Production wiring of a SessionManager for a resolved Config. */
export function createSessionManager(config: Config, deps: SessionDeps = {}): SessionManager {
  return new SessionManager({
    school: config.school,
    store: deps.store ?? new FileSessionStore(config.stateDir),
    strategies: [
      new BankIdBrowserStrategy({
        orgid: config.orgId,
        userType: config.userType,
        clientId: config.clientId,
        callbackPort: config.callbackPort,
        fetchImpl: deps.fetchImpl,
        openBrowser: deps.openBrowser,
      }),
    ],
  });
}

/** Guardian data API bound to the manager's live client. */
export function createGuardianApi(manager: SessionManager): GuardianApi {
  const client = manager.getClient();
  return new GuardianApi({
    school: client.school,
    accessToken: () => client.accessToken,
    cookieHeader: () => {
      try {
        return client.cookieHeader;
      } catch {
        return null;
      }
    },
  });
}
