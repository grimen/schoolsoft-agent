/**
 * Configuration model. Pure: nothing here reads the environment or the
 * filesystem — adapters gather `ConfigSource`s (flags, env, config file)
 * and pass them in, highest precedence first. Production object graphs
 * are built in wiring.ts.
 */
import { join } from "node:path";
import { DEFAULT_CALLBACK_PORT } from "./auth/callback-server.js";
import { AgentError, InputError } from "./errors/index.js";
import {
  DEFAULT_CLIENT_ID_BY_USER_TYPE,
  DEFAULT_USER_TYPE,
  SCHOOLSOFT_USER_TYPES,
  type SchoolsoftUserType,
} from "./constants.js";
import type { BrowserEngine } from "./browser/session.js";
import type { QuietHours } from "./keepalive/scheduler.js";
import { unchanged, type VersionedFormat } from "./versioned.js";
import { BUDGET_BOUNDS, type BudgetLimits } from "./budget/policy.js";
import { accountKey, accountsOf, entryOf, isRecord } from "./accounts.js";

/** off: nothing in the background. app: refresh the API token. all: also touch the web session. */
export const KEEPALIVE_MODES = ["off", "app", "all"] as const;
export type KeepaliveMode = (typeof KEEPALIVE_MODES)[number];

export interface KeepaliveConfig {
  mode: KeepaliveMode;
  /** Pause between web-session touches. */
  webIntervalMs: number;
  quietHours: QuietHours | null;
}

export const DEFAULT_KEEPALIVE_WEB_MINUTES = 10;
export const MIN_KEEPALIVE_WEB_MINUTES = 5;
export const MAX_KEEPALIVE_WEB_MINUTES = 120;

export interface Config {
  /** School portal provider id (src/providers); "schoolsoft" unless configured. */
  provider: string;
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
  /** Headless browser engine for browser-only capabilities. */
  browser: BrowserEngine;
  /** Operations that change data at the school portal may run. Off unless the user turns it on. */
  allowWrites: boolean;
  /** In-memory read cache (default on; never on disk). */
  cache: boolean;
  /** Background session keepalive for long-lived processes (default off). */
  keepalive: KeepaliveConfig;
  /** Overrides of the provider's request budget (rate, burst, parallelism); absent keys keep its defaults. */
  requestBudget: Partial<BudgetLimits>;
}

/** A partial, untyped-ish config from one source (file, env, flags). */
export interface ConfigSource {
  provider?: string;
  school?: string;
  orgId?: string;
  userType?: string;
  clientId?: string;
  callbackPort?: number | string;
  stateDir?: string;
  configDir?: string;
  browserEngine?: string;
  browserCdp?: string;
  allowWrites?: boolean | string;
  cache?: string | boolean;
  keepalive?: string;
  keepaliveWebMinutes?: number | string;
  keepaliveQuietHours?: string;
  requestsPerMinute?: number | string;
  requestBurst?: number | string;
  maxConcurrentRequests?: number | string;
}

/** Settings that belong to one account (they choose the tenant and its login); the rest belong to the machine. */
export const ACCOUNT_SETTINGS = ["provider", "school", "orgId", "userType", "clientId"] as const;
export type AccountSettings = Pick<ConfigSource, (typeof ACCOUNT_SETTINGS)[number]>;

/** config.json as stored from v2 on (without its version): the account settings per account. */
export interface ConfigDocument extends ConfigSource {
  /** Key of the current account (accounts.ts). */
  account?: string;
  accounts?: Record<string, AccountSettings>;
}

/** Which account the sources above the file (flags, environment) select, if any. */
export interface AccountSelection {
  provider?: string;
  school?: string;
}

const isAccountSetting = (key: string): boolean =>
  (ACCOUNT_SETTINGS as readonly string[]).includes(key);

/** An account's stored settings; nothing when the entry is missing or not an object. */
function settingsOf(doc: ConfigDocument, account: string | undefined): AccountSettings {
  const entry = account === undefined ? undefined : entryOf<unknown>(doc, account);
  return isRecord(entry) ? (entry as AccountSettings) : {};
}

/**
 * Move the account settings of a document that names a school into that
 * school's `accounts` entry and make it the current account. It is the
 * v1 → v2 migration, and it runs on every read too, so the top-level keys
 * stay valid settings. Account settings without a school stay at the top
 * level, where they apply to whichever account is selected.
 */
export function foldAccountSettings(doc: ConfigDocument): ConfigDocument {
  if (typeof doc.school !== "string" || doc.school === "") return doc;
  const settings: Record<string, unknown> = {};
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc)) {
    if (k === "account" || k === "accounts") continue;
    if (!isAccountSetting(k)) rest[k] = v;
    else if (v !== undefined) settings[k] = v;
  }
  const account = accountKey(doc.provider, doc.school);
  return {
    account,
    accounts: {
      ...accountsOf<AccountSettings>(doc),
      [account]: { ...settingsOf(doc, account), ...settings },
    },
    ...rest,
  };
}

/**
 * The file's settings for the selected account: the top-level settings with
 * that account's entry on top. Nothing selected: the file's current account.
 * A selected school without an entry adds no account settings, so it never
 * borrows another school's orgId or login route.
 */
export function accountSource(doc: ConfigDocument, selection: AccountSelection = {}): ConfigSource {
  const folded = foldAccountSettings(doc);
  const { account: current, accounts: _accounts, ...top } = folded;
  const account = selection.school
    ? accountKey(
        selection.provider ?? settingsOf(folded, current).provider ?? top.provider,
        selection.school,
      )
    : current;
  return { ...top, ...settingsOf(folded, account) };
}

/** config.json's format; the adapter that reads the file applies it. v1 → v2 keys the account settings by account. */
export const CONFIG_FORMAT: VersionedFormat = {
  migrations: [unchanged, foldAccountSettings],
};

export class ConfigValueError extends AgentError {
  constructor(name: string, value: unknown, expected: string) {
    super({
      kind: "input",
      key: "config_value_invalid",
      params: { name, value: String(value), expected },
      hint: "fix_input",
    });
  }
}

export class NotConfiguredError extends AgentError {
  constructor(reason: string) {
    super({ kind: "not_configured", key: "not_configured", params: { reason }, hint: "configure" });
  }
}

/** Environment variable names (the only place they are spelled out). */
export const ENV = {
  provider: "SCHOOLSOFT_PROVIDER",
  school: "SCHOOLSOFT_SCHOOL",
  orgId: "SCHOOLSOFT_ORGID",
  userType: "SCHOOLSOFT_USER_TYPE",
  clientId: "SCHOOLSOFT_CLIENT_ID",
  callbackPort: "SCHOOLSOFT_CALLBACK_PORT",
  stateDir: "SCHOOLSOFT_STATE_DIR",
  configDir: "SCHOOLSOFT_CONFIG_DIR",
  browserEngine: "SCHOOLSOFT_BROWSER_ENGINE",
  browserCdp: "SCHOOLSOFT_BROWSER_CDP",
  allowWrites: "SCHOOLSOFT_ALLOW_WRITES",
  cache: "SCHOOLSOFT_CACHE",
  keepalive: "SCHOOLSOFT_KEEPALIVE",
  keepaliveWebMinutes: "SCHOOLSOFT_KEEPALIVE_WEB_MINUTES",
  keepaliveQuietHours: "SCHOOLSOFT_KEEPALIVE_QUIET_HOURS",
  requestsPerMinute: "SCHOOLSOFT_REQUESTS_PER_MINUTE",
  requestBurst: "SCHOOLSOFT_REQUEST_BURST",
  maxConcurrentRequests: "SCHOOLSOFT_MAX_CONCURRENT_REQUESTS",
} as const;

/** Map SCHOOLSOFT_* variables to a ConfigSource (empty strings ignored). */
export function envSource(env: Record<string, string | undefined>): ConfigSource {
  const pick = (k: string) => (env[k] ? env[k] : undefined);
  return {
    provider: pick(ENV.provider),
    school: pick(ENV.school),
    orgId: pick(ENV.orgId),
    userType: pick(ENV.userType),
    clientId: pick(ENV.clientId),
    callbackPort: pick(ENV.callbackPort),
    stateDir: pick(ENV.stateDir),
    configDir: pick(ENV.configDir),
    browserEngine: pick(ENV.browserEngine),
    browserCdp: pick(ENV.browserCdp),
    allowWrites: pick(ENV.allowWrites),
    cache: pick(ENV.cache),
    keepalive: pick(ENV.keepalive),
    keepaliveWebMinutes: pick(ENV.keepaliveWebMinutes),
    keepaliveQuietHours: pick(ENV.keepaliveQuietHours),
    requestsPerMinute: pick(ENV.requestsPerMinute),
    requestBurst: pick(ENV.requestBurst),
    maxConcurrentRequests: pick(ENV.maxConcurrentRequests),
  };
}

/** Only an explicit yes turns writes on; anything unrecognised is an error, never a silent "on". */
function parseSwitch(raw: boolean | string | undefined, name: string): boolean {
  if (raw === undefined || typeof raw === "boolean") return raw ?? false;
  const v = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  throw new InputError(`${name} "${raw}" is not a switch; use 1 or 0`);
}

/** Platform config directory for this app. */
export function defaultConfigDir(
  home: string,
  platform: NodeJS.Platform,
  env: Record<string, string | undefined> = {},
): string {
  if (platform === "darwin")
    return join(home, "Library", "Application Support", "schoolsoft-agent");
  if (platform === "win32")
    return join(env.APPDATA ?? join(home, "AppData", "Roaming"), "schoolsoft-agent");
  return join(env.XDG_CONFIG_HOME ?? join(home, ".config"), "schoolsoft-agent");
}

function first<K extends keyof ConfigSource>(
  sources: ConfigSource[],
  key: K,
): ConfigSource[K] | undefined {
  for (const s of sources) {
    const v = s[key];
    if (v !== undefined && v !== "") return v;
  }
  return undefined;
}

function resolveCache(raw: string | boolean | undefined): boolean {
  if (raw === undefined || raw === true || raw === "on") return true;
  if (raw === false || raw === "off") return false;
  throw new ConfigValueError("cache", raw, "on | off");
}

/** "22-6": local hours, start inclusive, end exclusive, may wrap midnight. */
export function parseQuietHours(raw: string | undefined): QuietHours | null {
  if (raw === undefined) return null;
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(raw.trim());
  const startHour = Number(m?.[1]);
  const endHour = Number(m?.[2]);
  if (!m || startHour > 23 || endHour > 23 || startHour === endHour) {
    throw new ConfigValueError("keepaliveQuietHours", raw, "HH-HH (0-23), e.g. 22-6");
  }
  return { startHour, endHour };
}

function resolveKeepalive(sources: ConfigSource[]): KeepaliveConfig {
  const mode = first(sources, "keepalive") ?? "off";
  if (!(KEEPALIVE_MODES as readonly string[]).includes(mode)) {
    throw new ConfigValueError("keepalive", mode, KEEPALIVE_MODES.join(" | "));
  }
  const rawMinutes = first(sources, "keepaliveWebMinutes");
  const webMinutes = rawMinutes === undefined ? DEFAULT_KEEPALIVE_WEB_MINUTES : Number(rawMinutes);
  if (
    !Number.isInteger(webMinutes) ||
    webMinutes < MIN_KEEPALIVE_WEB_MINUTES ||
    webMinutes > MAX_KEEPALIVE_WEB_MINUTES
  ) {
    throw new ConfigValueError(
      "keepaliveWebMinutes",
      rawMinutes,
      `${MIN_KEEPALIVE_WEB_MINUTES}-${MAX_KEEPALIVE_WEB_MINUTES}`,
    );
  }
  return {
    mode: mode as KeepaliveMode,
    webIntervalMs: webMinutes * 60_000,
    quietHours: parseQuietHours(first(sources, "keepaliveQuietHours")),
  };
}

const BUDGET_KEYS = {
  requestsPerMinute: "perMinute",
  requestBurst: "burst",
  maxConcurrentRequests: "maxInFlight",
} as const satisfies Record<string, keyof BudgetLimits>;

/** Whole numbers within BUDGET_BOUNDS; a value outside them is an error, never clamped silently. */
function resolveRequestBudget(sources: ConfigSource[]): Partial<BudgetLimits> {
  const out: Partial<BudgetLimits> = {};
  for (const [name, key] of Object.entries(BUDGET_KEYS) as [
    keyof typeof BUDGET_KEYS,
    keyof BudgetLimits,
  ][]) {
    const raw = first(sources, name);
    if (raw === undefined) continue;
    const value = Number(raw);
    const { min, max } = BUDGET_BOUNDS[key];
    if (!Number.isInteger(value) || value < min || value > max)
      throw new ConfigValueError(name, raw, `a whole number from ${min} to ${max}`);
    out[key] = value;
  }
  return out;
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
    throw new InputError(
      `Invalid userType "${rawUserType}". Expected one of: ${SCHOOLSOFT_USER_TYPES.join(", ")}`,
    );
  }
  const userType = rawUserType as SchoolsoftUserType;

  const rawPort = first(sources, "callbackPort");
  const callbackPort = rawPort === undefined ? DEFAULT_CALLBACK_PORT : Number(rawPort);
  if (!Number.isInteger(callbackPort) || callbackPort < 1 || callbackPort > 65535) {
    throw new InputError(`callbackPort "${rawPort}" is not a port number`);
  }

  const configDir =
    first(sources, "configDir") ?? defaultConfigDir(defaults.home, defaults.platform, defaults.env);
  const engineKind = first(sources, "browserEngine") ?? "chromium";
  const cdp = first(sources, "browserCdp");
  let browser: BrowserEngine;
  if (engineKind === "cdp") {
    if (!cdp) throw new InputError(`browserEngine "cdp" needs a CDP endpoint (${ENV.browserCdp})`);
    browser = { kind: "cdp", endpoint: cdp };
  } else if (engineKind === "chromium") {
    browser = { kind: "chromium", headless: true };
  } else {
    throw new InputError(
      `browserEngine "${engineKind}" is not supported; expected chromium or cdp`,
    );
  }
  return {
    provider: first(sources, "provider") ?? "schoolsoft",
    school,
    orgId: first(sources, "orgId"),
    userType,
    clientId: first(sources, "clientId") ?? DEFAULT_CLIENT_ID_BY_USER_TYPE[userType],
    callbackPort,
    stateDir: first(sources, "stateDir") ?? join(configDir, "state"),
    configDir,
    browser,
    allowWrites: parseSwitch(first(sources, "allowWrites"), "allowWrites"),
    cache: resolveCache(first(sources, "cache")),
    keepalive: resolveKeepalive(sources),
    requestBudget: resolveRequestBudget(sources),
  };
}
