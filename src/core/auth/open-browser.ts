/** Opens a URL in the OS default browser; `spawnImpl`/`os` are injectable for tests. */
import { spawn } from "node:child_process";
import { platform } from "node:os";

/** Opener command per platform; exported for tests. */
export function openerCommand(url: string, os: NodeJS.Platform): string[] {
  return os === "darwin"
    ? ["open", url]
    : os === "win32"
      ? ["cmd", "/c", "start", "", url.replace(/&/g, "^&")]
      : ["xdg-open", url];
}

export function defaultOpenInBrowser(
  url: string,
  spawnImpl: typeof spawn = spawn,
  os: NodeJS.Platform = platform(),
): void {
  const cmd = openerCommand(url, os);
  const child = spawnImpl(cmd[0], cmd.slice(1), { detached: true, stdio: "ignore" });
  // Without this, a missing opener binary crashes the process.
  child.on("error", (e) => {
    console.error(
      `Could not open browser automatically (${e.message}). ` +
        `Ask the user to open the login URL manually.`,
    );
  });
  child.unref();
}
