import { sessionManager } from "../src/services/wiring.js";
const manager = sessionManager();
try {
  await manager.ensureSession();
  console.log("✓ Existing session still valid — no login needed.");
} catch {
  console.log("→ Opening browser — complete BankID there…");
  const info = await manager.login();
  console.log("✓ Logged in:", info);
}
