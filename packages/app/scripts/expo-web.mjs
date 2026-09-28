// Expo's web dev server, started the way `make app-web` starts it (shared with dev-bundle-smoke.mjs).
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
const EXPO_CLI = createRequire(import.meta.url).resolve("expo/bin/cli");

/**
 * No CI=1: Expo turns Metro's watch mode (and so reloads) off in CI mode. Without a
 * terminal Expo runs non-interactively and never prompts. BROWSER=none: the page must be
 * opened through the proxy, never on Expo's own port.
 */
export function startExpoWeb(port, options = {}) {
  return spawn(process.execPath, [EXPO_CLI, "start", "--web", "--port", String(port)], {
    cwd: APP_DIR,
    stdio: "inherit",
    ...options,
    env: { ...process.env, BROWSER: "none" },
  });
}
