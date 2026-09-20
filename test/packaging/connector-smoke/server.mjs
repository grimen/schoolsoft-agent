/** Test-only entry for the container flow smoke: the image's own built composition
 * (dist/http/start.js) with the portal's HTTP replaced by fake-upstream.mjs. Mounted
 * read-only into the container; it is not part of the image and no production code
 * path can select it. Usage: node server.mjs [path to dist/http/start.js]
 */
import { pathToFileURL } from "node:url";
import { fakeUpstream } from "./fake-upstream.mjs";

const { startConnector } = await import(
  pathToFileURL(process.argv[2] ?? "/app/dist/http/start.js").href
);
const { server, runtime } = startConnector(process.env, { fetchImpl: fakeUpstream().fetchImpl });
const close = () => {
  server.close();
  server.closeAllConnections();
  void runtime.close();
};
process.once("SIGTERM", close);
process.once("SIGINT", close);
