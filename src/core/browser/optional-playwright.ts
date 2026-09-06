/**
 * The single place the optional `playwright` dependency is imported. Kept
 * apart so the rest of the browser code is unit-testable with fakes.
 *
 * Coverage: both outcomes are exercised by shipped-artifact tests rather
 * than unit tests: presence by `make e2e-artifact` (extractors in real
 * Chromium), absence by `scripts/pack-smoke.sh` (installed with
 * --omit=optional, browser-backed tools must fail with the install hint).
 */
import { BrowserRequiredError } from "../portal/types.js";

/** The slice of the playwright module we use; injectable for tests. */
export interface PlaywrightLike {
  chromium: {
    launch(o: { headless: boolean }): Promise<import("playwright").Browser>;
    connectOverCDP(endpoint: string): Promise<import("playwright").Browser>;
    executablePath(): string;
  };
}

/* c8 ignore start */
export async function loadPlaywright(): Promise<PlaywrightLike> {
  try {
    return (await import("playwright")) as unknown as PlaywrightLike;
  } catch (e) {
    throw new BrowserRequiredError(
      "browser",
      `playwright is not installed: ${(e as Error).message}`,
    );
  }
}
/* c8 ignore stop */
