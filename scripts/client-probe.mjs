// Imports the typed client the way an app does (`schoolsoft-agent/client`, through the
// package's exports) from an installed tarball, makes one call with a stand-in fetch, and
// fails when loading it reached any module but the client's own files and Zod.
//   node scripts/client-probe.mjs <directory containing node_modules/schoolsoft-agent>
import { createRequire, registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";
import { join } from "node:path";

const [base] = process.argv.slice(2);
if (!base) {
  console.error("usage: client-probe.mjs <dir>");
  process.exit(2);
}
const loaded = [];
registerHooks({
  resolve(specifier, context, next) {
    const resolved = next(specifier, context);
    loaded.push(resolved.url);
    return resolved;
  },
});
// Resolved from the install, through the package's exports (the `default` condition).
const entry = pathToFileURL(
  createRequire(join(base, "probe.js")).resolve("schoolsoft-agent/client"),
).href;
const installed = pathToFileURL(join(realpathSync(base), "node_modules")).href;
const { createClient, memoryTokenStore } = await import(entry);
const client = createClient({
  baseUrl: "https://connector.example",
  clientId: "probe",
  tokens: memoryTokenStore({ accessToken: "a", refreshToken: "r" }),
  fetch: async () =>
    new Response(JSON.stringify({ children: [{ id: 1, firstName: "P" }], childInFocus: 1 }), {
      headers: { "content-type": "application/json" },
    }),
});
const answer = await client.children();
if (answer.children[0].id !== 1) throw new Error("client-probe: unexpected answer");
const foreign = loaded.filter(
  (url) =>
    url.startsWith("file:") &&
    !/\/node_modules\/schoolsoft-agent\/dist\/client\//.test(url) &&
    !/\/node_modules\/zod\//.test(url),
);
if (!entry.startsWith(installed + "/schoolsoft-agent/dist/client/") || foreign.length) {
  console.error("client-probe: the client reached", foreign.length ? foreign : entry);
  process.exit(1);
}
console.log(
  `client-probe: schoolsoft-agent/client loads ${loaded.length} modules (client + zod only)`,
);
