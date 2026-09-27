// `make app-check`: the live dev server `make app-web` runs must bundle the app for web.
// Neither `expo export` nor the E2E's static export goes through Metro's dev server, which
// once failed on the workspace's self-link (node_modules/schoolsoft-agent -> ..) with
// "Failed to collapse" (see metro.config.js).
import { once } from "node:events";
import net from "node:net";
import { stripVTControlCharacters } from "node:util";
import { startExpoWeb } from "./expo-web.mjs";

// app/index.tsx's own text key, and the discovery path from src/connection/client.ts,
// which imports the typed client (`schoolsoft-agent/client`).
const MARKERS = ["signInLater", "/.well-known/oauth-protected-resource/mcp"];
const START_TIMEOUT_MS = 120_000;
const BUNDLE_TIMEOUT_MS = 300_000;

async function freePort() {
  const probe = net.createServer().listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address();
  await new Promise((r) => probe.close(r));
  return port;
}

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
// Its own process group, so stopping it also stops Metro's workers.
const expo = startExpoWeb(port, { stdio: ["ignore", "pipe", "pipe"], detached: true });
let log = "";
expo.stdout.on("data", (chunk) => (log += chunk));
expo.stderr.on("data", (chunk) => (log += chunk));
let exited = false;
const exit = once(expo, "exit").then(() => (exited = true));

function signalGroup(signal) {
  try {
    process.kill(-expo.pid, signal);
  } catch {
    // already gone
  }
}
function stop() {
  if (exited) return;
  signalGroup("SIGTERM");
  setTimeout(() => signalGroup("SIGKILL"), 10_000).unref();
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    stop();
    process.exit(1);
  });

/** Metro answers a failed bundle with JSON whose `message` holds the error; show that, plainly. */
function metroMessage(body) {
  try {
    return JSON.parse(body).message ?? body;
  } catch {
    return body;
  }
}

function fail(message, detail = "") {
  const lines = stripVTControlCharacters(detail).split("\n").slice(0, 40).join("\n");
  throw new Error(`${message}${lines ? `\n${lines}` : ""}`);
}

async function waitForIndex() {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (exited) fail("Expo's dev server exited before it answered", log);
    try {
      const response = await fetch(base + "/", { headers: { accept: "text/html" } });
      if (response.ok) return await response.text();
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return fail(
    `Expo's dev server did not answer on ${base} within ${START_TIMEOUT_MS / 1000} s`,
    log,
  );
}

let failed = false;
try {
  const html = await waitForIndex();
  const src = /<script[^>]*\ssrc="([^"]*\.bundle[^"]*)"/.exec(html)?.[1];
  if (!src) fail(`the dev server's index.html names no entry bundle`, html);
  const url = new URL(src.replaceAll("&amp;", "&"), base);
  const response = await fetch(url, { signal: AbortSignal.timeout(BUNDLE_TIMEOUT_MS) });
  const body = await response.text();
  if (response.status !== 200)
    fail(`GET ${url.pathname}${url.search} answered ${response.status}`, metroMessage(body));
  const missing = MARKERS.filter((m) => !body.includes(m));
  if (missing.length) fail(`the dev bundle lacks the app's code: ${missing.join(", ")}`);
  console.log(`dev bundle ok: ${url.pathname} (${body.length} bytes, 200)`);
} catch (error) {
  failed = true;
  console.error(`dev-bundle smoke failed: ${error.message}`);
} finally {
  stop();
  await exit;
  signalGroup("SIGKILL"); // any worker that outlived Expo itself
}
process.exit(failed ? 1 : 0);
