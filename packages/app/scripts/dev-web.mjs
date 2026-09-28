// `make app-web`: check the connector, put the proxy up, then start Expo's web dev server
// behind it (or serve a static export). Either one failing stops both, with a non-zero exit.
import net from "node:net";
import { parseArgs } from "node:util";
import { checkConnector, createProxy } from "./dev-proxy.mjs";
import { startExpoWeb } from "./expo-web.mjs";

// IPv4 loopback, not "localhost": that name may resolve to [::1] only, leaving 127.0.0.1 refused.
const HOST = "127.0.0.1";

const { values } = parseArgs({
  options: {
    connector: { type: "string" },
    port: { type: "string", default: "8080" },
    static: { type: "string" },
  },
});
if (!values.connector) {
  console.error("--connector is required, e.g. --connector http://localhost:3000");
  process.exit(2);
}
const connector = new URL(values.connector);
try {
  await checkConnector(connector);
} catch (error) {
  console.error(`${error.message}. CONNECTOR_URL must be the connector's SCHOOLSOFT_PUBLIC_URL.`);
  process.exit(1);
}
const port = Number(values.port);
const appPort = port + 1;
let expo;
let stopping = false;

function stop(code, message) {
  if (stopping) return;
  stopping = true;
  if (message) console.error(message);
  proxy.close();
  if (expo && expo.exitCode === null && expo.signalCode === null) expo.kill("SIGTERM");
  process.exit(code);
}

/** Something already answers there (Expo would pick another port, or prompt to). */
function answering(p) {
  return new Promise((resolve) => {
    const socket = net.connect(p, HOST);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

const proxy = values.static
  ? createProxy({ connector, staticDir: values.static })
  : createProxy({ connector, app: new URL(`http://${HOST}:${appPort}`) });
proxy.on("error", (error) =>
  stop(
    1,
    error.code === "EADDRINUSE"
      ? `port ${port} on ${HOST} is already in use; stop whatever holds it and try again.`
      : `the proxy on http://${HOST}:${port} failed: ${error.message}`,
  ),
);
proxy.listen(port, HOST, async () => {
  if (!values.static) {
    if (await answering(appPort))
      return stop(
        1,
        `port ${appPort}, which Expo's dev server needs behind the proxy, is already in use; stop whatever holds it and try again.`,
      );
    expo = startExpoWeb(appPort);
    expo.on("error", (error) => stop(1, `Expo's dev server could not start: ${error.message}`));
    expo.on("exit", (code, signal) =>
      stop(1, `Expo's dev server stopped (${signal ?? `exit code ${code}`}); stopping the proxy.`),
    );
  }
  console.log(
    `ready http://${HOST}:${port}${expo ? ` (open this, not Expo's own port ${appPort})` : ""}`,
  );
});
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
