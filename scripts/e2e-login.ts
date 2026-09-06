/**
 * One interactive BankID login to seed the session used by the E2E suite.
 * Equivalent to `schoolsoft-agent login` but kept as a script so it runs
 * from source with tsx.
 */
import { homedir } from "node:os";
import { loadContext } from "../src/shared/bootstrap.js";

const ctx = loadContext({ env: process.env, home: homedir(), platform: process.platform })();
try {
  await ctx.manager.ensureSession();
  console.log("✓ Existing session still valid — no login needed.");
} catch {
  console.log("→ Opening browser — complete BankID there…");
  const info = await ctx.manager.login();
  console.log("✓ Logged in:", info);
}
