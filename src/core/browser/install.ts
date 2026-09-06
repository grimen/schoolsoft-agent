/**
 * Is the optional browser usable, and how to make it so. Pure functions
 * with injectable probes so they are unit-testable without Playwright.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import type { BrowserEngine } from "./session.js";

export interface BrowserStatus {
  engine: BrowserEngine["kind"];
  playwrightInstalled: boolean;
  chromiumInstalled: boolean;
  executablePath?: string;
  /** True when a browser-backed capability would work right now. */
  ready: boolean;
  hint?: string;
}

export interface StatusProbes {
  /** Resolve playwright's package.json path, or throw when not installed. */
  resolvePlaywright?: () => string;
  /** Chromium executable path per playwright, or throw when not downloaded. */
  chromiumPath?: () => Promise<string>;
}

const require = createRequire(import.meta.url);

export async function browserStatus(
  engine: BrowserEngine,
  probes: StatusProbes = {},
): Promise<BrowserStatus> {
  const resolve = probes.resolvePlaywright ?? (() => require.resolve("playwright/package.json"));
  const chromiumPath =
    probes.chromiumPath ??
    (async () => {
      const pw = (await import("playwright")) as unknown as {
        chromium: { executablePath(): string };
      };
      return pw.chromium.executablePath();
    });
  let playwrightInstalled = false;
  try {
    resolve();
    playwrightInstalled = true;
  } catch {
    /* not installed */
  }
  if (engine.kind === "cdp") {
    return {
      engine: "cdp",
      playwrightInstalled,
      chromiumInstalled: false,
      ready: playwrightInstalled,
      hint: playwrightInstalled ? undefined : "install playwright to connect to the CDP endpoint",
    };
  }
  if (!playwrightInstalled) {
    return {
      engine: "chromium",
      playwrightInstalled: false,
      chromiumInstalled: false,
      ready: false,
      hint: "run: schoolsoft-agent browser install",
    };
  }
  let executablePath: string | undefined;
  try {
    executablePath = await chromiumPath();
  } catch {
    /* unresolved */
  }
  const chromiumInstalled = Boolean(executablePath && existsSync(executablePath));
  return {
    engine: "chromium",
    playwrightInstalled,
    chromiumInstalled,
    executablePath,
    ready: chromiumInstalled,
    hint: chromiumInstalled ? undefined : "run: schoolsoft-agent browser install",
  };
}

export type Spawner = (cmd: string, args: string[]) => Promise<number>;

const defaultSpawner: Spawner = (cmd, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });

/** Download Chromium through playwright's own CLI. Returns the exit code. */
export async function installChromium(
  spawner: Spawner = defaultSpawner,
  resolvePlaywright?: () => string,
): Promise<number> {
  const resolve = resolvePlaywright ?? (() => require.resolve("playwright/package.json"));
  let pkg: string;
  try {
    pkg = resolve();
  } catch {
    throw new Error(
      'playwright is not installed. Run "npm install -g playwright" (or reinstall schoolsoft-agent without --omit=optional), then "schoolsoft-agent browser install".',
    );
  }
  const cli = join(dirname(pkg), "cli.js");
  return spawner(process.execPath, [cli, "install", "chromium"]);
}
