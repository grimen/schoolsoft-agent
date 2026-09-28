// Development only: one origin for the app and the connector (spec: Development proxy).
// Rewrites only the upstream address, Host, and Origin on connector-bound requests.
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";

const CONNECTOR_PATHS = [/^\/api\/v1(\/|$)/, /^\/token$/, /^\/revoke$/, /^\/\.well-known\//];
const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

export function upstreamFor(pathname) {
  return CONNECTOR_PATHS.some((r) => r.test(pathname)) ? "connector" : "app";
}

function forward(req, res, target, rewriteOrigin) {
  const headers = { ...req.headers, host: target.host };
  if (rewriteOrigin && headers.origin) headers.origin = target.origin;
  const lib = target.protocol === "https:" ? https : http;
  const upstream = lib.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      path: req.url,
      method: req.method,
      headers,
    },
    (answer) => {
      res.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(res);
    },
  );
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
    res.end("upstream unreachable");
  });
  req.pipe(upstream);
}

function serveStatic(req, res, dir) {
  const root = resolve(dir);
  const rawPathname = new URL(req.url, "http://x").pathname;
  let pathname;
  try {
    pathname = decodeURIComponent(rawPathname);
  } catch (error) {
    if (!(error instanceof URIError)) throw error;
    pathname = null; // malformed percent-encoding: fall back like any other unknown path.
  }
  const candidate = pathname === null ? null : resolve(join(root, normalize(pathname)));
  const inside = candidate !== null && (candidate === root || candidate.startsWith(root + sep));
  const file =
    inside && existsSync(candidate) && statSync(candidate).isFile()
      ? candidate
      : join(root, "index.html");
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
}

export function createProxy(options) {
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, "http://x").pathname;
    if (upstreamFor(pathname) === "connector") return forward(req, res, options.connector, true);
    if ("staticDir" in options) return serveStatic(req, res, options.staticDir);
    return forward(req, res, options.app, false);
  });
  // The dev server's hot-reload socket.
  server.on("upgrade", (req, socket, head) => {
    if (!("app" in options)) return socket.destroy();
    const target = options.app;
    const upstream = net.connect(Number(target.port), target.hostname, () => {
      const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
      for (const [k, v] of Object.entries({ ...req.headers, host: target.host }))
        lines.push(`${k}: ${v}`);
      upstream.write(lines.join("\r\n") + "\r\n\r\n");
      upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
  });
  return server;
}

/** Healthy, and reached at its own public URL (the REST surface refuses any other Origin). */
export async function checkConnector(connector, fetchImpl = fetch) {
  let status;
  try {
    status = (await fetchImpl(new URL("/healthz", connector))).status;
  } catch (cause) {
    throw new Error(`the connector at ${connector.origin} can't be reached`, { cause });
  }
  if (status !== 200)
    throw new Error(`the connector at ${connector.origin} answered ${status} on /healthz`);
  let publicOrigin;
  try {
    const metadata = await (
      await fetchImpl(new URL("/.well-known/oauth-authorization-server", connector))
    ).json();
    publicOrigin = new URL(metadata.issuer).origin;
  } catch (cause) {
    throw new Error(`the connector at ${connector.origin} returned invalid OAuth metadata`, {
      cause,
    });
  }
  if (publicOrigin !== connector.origin) {
    throw new Error(`${connector.origin} doesn't match the connector's public URL ${publicOrigin}`);
  }
}
