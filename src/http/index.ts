#!/usr/bin/env node
/** Process wiring exercised by the packaged connector smoke test. */
import { startConnector } from "./start.js";
try {
  const { server, runtime } = startConnector(process.env);
  const close = () => {
    server.close();
    void runtime.close();
  };
  process.once("SIGTERM", close);
  process.once("SIGINT", close);
  server.on("error", () => {
    process.stderr.write("Connector could not start. Check your port and hosting settings.\n");
    process.exitCode = 1;
  });
} catch {
  process.stderr.write(
    "Connector could not start. Check the required settings in the parent connector guide.\n",
  );
  process.exitCode = 1;
}
