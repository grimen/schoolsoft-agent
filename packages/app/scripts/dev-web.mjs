// `make app-web`: check the connector, start Expo's web dev server (or serve a static export), put the proxy in front.
import { spawn } from "node:child_process";
import { parseArgs } from "node:util";
import { checkConnector, createProxy } from "./dev-proxy.mjs";

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
let expo;
let proxy;
if (values.static) {
  proxy = createProxy({ connector, staticDir: values.static });
} else {
  const appPort = port + 1;
  expo = spawn("npx", ["expo", "start", "--web", "--port", String(appPort)], {
    stdio: "inherit",
    env: { ...process.env, BROWSER: "none", CI: "1" },
  });
  proxy = createProxy({ connector, app: new URL(`http://localhost:${appPort}`) });
}
proxy.listen(port, "localhost", () => console.log(`ready http://localhost:${port}`));
const stop = () => {
  proxy.close();
  expo?.kill();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
