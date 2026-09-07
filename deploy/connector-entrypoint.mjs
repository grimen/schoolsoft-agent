/** Prepare the fixed persistent mount, then permanently drop root before HTTP starts. */
import { chownSync, chmodSync, lstatSync } from "node:fs";

try {
  if (process.env.SCHOOLSOFT_STATE_DIR !== "/data" || !lstatSync("/data").isDirectory()) {
    throw new Error("Invalid state mount");
  }
  if (process.getuid() === 0) {
    // Only this directory, never its children or a configurable path.
    chownSync("/data", 0, 0);
    chmodSync("/data", 0o700);
    chownSync("/data", 1000, 1000);
    process.setgroups([]);
    process.setgid(1000);
    process.setuid(1000);
  }
  if (process.getuid() !== 1000 || process.getgid() !== 1000) {
    throw new Error("Invalid runtime identity");
  }
  await import("../dist/http/index.js");
} catch {
  process.stderr.write(
    "Connector could not start. Check the private /data mount and service settings.\n",
  );
  process.exitCode = 1;
}
