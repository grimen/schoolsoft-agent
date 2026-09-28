import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkConnector, createProxy, upstreamFor } from "./dev-proxy.mjs";

/** An assert.rejects validator: the error message contains `text` verbatim (no regex escaping). */
const mentions = (text) => (error) => {
  assert.ok(
    error instanceof Error && error.message.includes(text),
    `expected "${text}" in: ${error?.message}`,
  );
  return true;
};

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return new URL(`http://127.0.0.1:${server.address().port}`);
}
function echo(name) {
  return http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        name,
        path: req.url,
        origin: req.headers.origin ?? null,
        host: req.headers.host,
      }),
    );
  });
}

test("routes the connector's paths and nothing else", () => {
  for (const p of [
    "/api/v1/children",
    "/api/v1/session",
    "/token",
    "/revoke",
    "/.well-known/oauth-authorization-server",
  ])
    assert.equal(upstreamFor(p), "connector", p);
  for (const p of [
    "/",
    "/dev-connect",
    "/_expo/static/js/web/entry.js",
    "/api",
    "/tokens",
    "/api/v2/x",
  ])
    assert.equal(upstreamFor(p), "app", p);
});

test("rewrites Origin and Host for the connector only", async () => {
  const connectorServer = echo("connector");
  const appServer = echo("app");
  const connector = await listen(connectorServer);
  const app = await listen(appServer);
  const proxy = createProxy({ connector, app });
  const base = await listen(proxy);
  try {
    const c = await (
      await fetch(new URL("/api/v1/children", base), { headers: { origin: base.origin } })
    ).json();
    assert.deepEqual([c.name, c.origin, c.host], ["connector", connector.origin, connector.host]);
    const a = await (
      await fetch(new URL("/dev-connect", base), { headers: { origin: base.origin } })
    ).json();
    assert.deepEqual([a.name, a.origin], ["app", base.origin]);
  } finally {
    for (const s of [proxy, connectorServer, appServer]) s.close();
  }
});

test("serves a static export with a single-page fallback", async () => {
  const dir = mkdtempSync(join(tmpdir(), "app-static-"));
  writeFileSync(join(dir, "index.html"), "<html>app</html>");
  writeFileSync(join(dir, "main.js"), "console.log(1)");
  const connectorServer = echo("connector");
  const connector = await listen(connectorServer);
  const proxy = createProxy({ connector, staticDir: dir });
  const base = await listen(proxy);
  try {
    assert.equal(await (await fetch(new URL("/main.js", base))).text(), "console.log(1)");
    assert.equal(await (await fetch(new URL("/dev-connect", base))).text(), "<html>app</html>");
  } finally {
    proxy.close();
    connectorServer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("never serves a file outside the static export", async () => {
  const parent = mkdtempSync(join(tmpdir(), "app-static-"));
  const dir = join(parent, "export");
  mkdirSync(dir);
  writeFileSync(join(dir, "index.html"), "<html>app</html>");
  writeFileSync(join(parent, "secret.txt"), "secret");
  const connectorServer = echo("connector");
  const connector = await listen(connectorServer);
  const proxy = createProxy({ connector, staticDir: dir });
  const base = await listen(proxy);
  try {
    // fetch() would normalize the dots away before sending; the raw request doesn't, and
    // the escaped slashes only become separators once the proxy decodes the path.
    for (const path of [
      "/..%2fsecret.txt",
      "/%2e%2e%2fsecret.txt",
      "/..%2f..%2fetc%2fpasswd",
      "/%2e%2e%2f%2e%2e%2fetc%2fpasswd",
    ]) {
      const answer = await rawRequest(base, path);
      assert.deepEqual(answer, { status: 200, text: "<html>app</html>" }, path);
    }
  } finally {
    proxy.close();
    connectorServer.close();
    rmSync(parent, { recursive: true, force: true });
  }
});

function rawRequest(base, path) {
  return new Promise((resolvePromise, reject) => {
    const req = http.request(
      { hostname: base.hostname, port: base.port, path, method: "GET" },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolvePromise({ status: res.statusCode, text: Buffer.concat(chunks).toString() }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

test("survives a malformed percent-encoded path in static mode", async () => {
  const dir = mkdtempSync(join(tmpdir(), "app-static-"));
  writeFileSync(join(dir, "index.html"), "<html>app</html>");
  const connectorServer = echo("connector");
  const connector = await listen(connectorServer);
  const proxy = createProxy({ connector, staticDir: dir });
  const base = await listen(proxy);
  try {
    // fetch() would normalize or reject this itself, so build the raw request by hand.
    const malformed = await rawRequest(base, "/%E0%A4%A");
    assert.equal(malformed.text, "<html>app</html>");
    // The process is still alive: an ordinary request right after still works.
    assert.equal(await (await fetch(new URL("/", base))).text(), "<html>app</html>");
  } finally {
    proxy.close();
    connectorServer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an unreachable upstream answers 502, not a hang", async () => {
  const proxy = createProxy({
    connector: new URL("http://127.0.0.1:9"),
    app: new URL("http://127.0.0.1:9"),
  });
  const base = await listen(proxy);
  try {
    assert.equal((await fetch(new URL("/api/v1/children", base))).status, 502);
  } finally {
    proxy.close();
  }
});

test("checkConnector names the URL when the connector is unreachable or unhealthy", async () => {
  await assert.rejects(checkConnector(new URL("http://127.0.0.1:9")), /http:\/\/127\.0\.0\.1:9/);
  const bad = http.createServer((_q, r) => {
    r.statusCode = 500;
    r.end();
  });
  const url = await listen(bad);
  try {
    await assert.rejects(checkConnector(url), mentions(url.origin));
  } finally {
    bad.close();
  }
});

function connectorWithIssuer(issuer) {
  return http.createServer((req, res) => {
    if (req.url === "/healthz") return res.end("ok");
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ issuer: typeof issuer === "function" ? issuer() : issuer }));
  });
}

test("checkConnector refuses a URL that is not the connector's public URL", async () => {
  // Reached as 127.0.0.1, but the connector says it is localhost: every REST call would be foreign-origin.
  let port;
  const server = connectorWithIssuer(() => `http://localhost:${port}/`);
  const url = await listen(server);
  port = url.port;
  try {
    await assert.rejects(
      checkConnector(url),
      /doesn't match the connector's public URL http:\/\/localhost:/,
    );
  } finally {
    server.close();
  }
});

test("checkConnector accepts the connector's own public URL", async () => {
  let origin;
  const server = connectorWithIssuer(() => `${origin}/`);
  const url = await listen(server);
  origin = url.origin;
  try {
    await checkConnector(url);
  } finally {
    server.close();
  }
});

function connectorWithBody(body) {
  return http.createServer((req, res) => {
    if (req.url === "/healthz") return res.end("ok");
    res.end(body);
  });
}

test("checkConnector names the URL when the metadata isn't JSON", async () => {
  const server = connectorWithBody("not json");
  const url = await listen(server);
  try {
    await assert.rejects(
      checkConnector(url),
      mentions(`${url.origin} returned invalid OAuth metadata`),
    );
  } finally {
    server.close();
  }
});

test("checkConnector names the URL when the metadata lacks issuer", async () => {
  const server = connectorWithIssuer(undefined);
  const url = await listen(server);
  try {
    await assert.rejects(
      checkConnector(url),
      mentions(`${url.origin} returned invalid OAuth metadata`),
    );
  } finally {
    server.close();
  }
});
