import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { connectorConfig } from "../../src/http/config.js";
import { ConnectorOAuthProvider } from "../../src/http/oauth.js";
import { createConnectorApp } from "../../src/http/server.js";
import { OwnerSessions } from "../../src/http/owner-session.js";
const config = connectorConfig({
  SCHOOLSOFT_PUBLIC_URL: "https://connector.example",
  SCHOOLSOFT_ADMIN_PASSWORD: "p".repeat(32),
  SCHOOLSOFT_STORAGE_KEY: "a".repeat(64),
  SCHOOLSOFT_SCHOOL: "example",
});
test("owner console enforces host, password, session, origin and CSRF and completes manual login routes", async () => {
  let loginError: "expired" | undefined;
  let authenticated = false,
    pending = false,
    broken = false,
    loggedOut = false;
  const oauth = new ConnectorOAuthProvider({
    resourceUrl: config.publicUrl + "/mcp",
    scopes: ["list_children"],
    repository: { read: () => undefined, write: () => {} },
  });
  const sessions = new OwnerSessions(config.adminPassword);
  const app = createConnectorApp({
    config,
    oauth,
    sessions,
    runtime: {
      status: async () => {
        if (broken) throw new Error("DO_NOT_EXPOSE");
        return {
          authenticated,
          loginInProgress: pending,
          loginError,
          children: [{ id: 1, name: "<Child>" }],
        };
      },
      beginLogin: async () => ({ url: "https://school.example/login?state=private&foo=1" }),
      callback: (state, code) => state === "valid" && code === "code",
      logout: async () => {
        loggedOut = true;
      },
      execute: async () => ({}),
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  let cookie = "";
  const request = (
    path: string,
    body?: Record<string, string>,
    extra: Record<string, string> = {},
  ): Promise<Response> =>
    new Promise((resolve, reject) => {
      const req = httpRequest(
        base + path,
        {
          method: body ? "POST" : "GET",
          headers: {
            Host: "connector.example",
            ...(cookie ? { Cookie: cookie } : {}),
            ...(body
              ? { "Content-Type": "application/x-www-form-urlencoded", Origin: config.publicUrl }
              : {}),
            ...extra,
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            const headers = new Headers();
            for (const [key, value] of Object.entries(res.headers))
              if (value !== undefined)
                headers.set(key, Array.isArray(value) ? value.join(", ") : value);
            resolve(new Response(Buffer.concat(chunks), { status: res.statusCode!, headers }));
          });
        },
      );
      req.on("error", reject);
      req.end(body ? new URLSearchParams(body).toString() : undefined);
    });
  try {
    assert.equal((await request("/healthz", undefined, { Host: "untrusted" })).status, 200);
    assert.equal((await request("/", undefined, { Host: "untrusted" })).status, 421);
    assert.equal((await request("/")).headers.get("location"), "/owner");
    assert.equal((await request("/owner")).headers.get("location"), "/owner/login");
    assert.match(
      (await request("/owner/consent?request=abc")).headers.get("location")!,
      /request=abc/,
    );
    assert.match(await (await request("/owner/login")).text(), /administrator password/);
    assert.match(await (await request("/owner/login?request=%22")).text(), /&quot;/);
    assert.equal(
      (
        await request(
          "/owner/login",
          { password: config.adminPassword },
          { Origin: "https://evil.example" },
        )
      ).status,
      403,
    );
    assert.equal((await request("/owner/login", { password: "bad" })).status, 401);
    const login = await request("/owner/login", { password: config.adminPassword });
    cookie = login.headers.get("set-cookie")!.split(";")[0];
    assert.match(login.headers.get("set-cookie")!, /HttpOnly/);
    assert.match(login.headers.get("set-cookie")!, /Secure/);
    assert.equal(login.headers.get("location"), "/owner");
    let response = await request("/owner");
    let html = await response.text();
    assert.match(html, /not connected/);
    const csrf = html.match(/name="csrf" value="([^"]+)"/)![1];
    assert.match(response.headers.get("content-security-policy")!, /frame-ancestors 'none'/);
    assert.equal((await request("/owner/schoolsoft/login", { csrf: "bad" })).status, 403);
    assert.equal(
      (await request("/owner/schoolsoft/login", { csrf }, { Origin: "https://evil.example" }))
        .status,
      403,
    );
    html = await (await request("/owner/schoolsoft/login", { csrf })).text();
    assert.match(html, /state=private&amp;foo=1/);
    loginError = "expired";
    assert.match(await (await request("/owner")).text(), /sign-in link expired/);
    loginError = undefined;
    for (let i = 0; i < 5; i++)
      assert.equal(
        (await request("/owner/login", { password: "wrong" }, { "X-Forwarded-For": "192.0.2.10" }))
          .status,
        401,
      );
    assert.equal(
      (
        await request(
          "/owner/login",
          { password: config.adminPassword },
          { "X-Forwarded-For": "192.0.2.11" },
        )
      ).status,
      302,
    );
    pending = true;
    assert.match(await (await request("/owner")).text(), /waiting for BankID/);
    pending = false;
    assert.equal((await request("/schoolsoft/callback")).status, 400);
    assert.equal((await request("/schoolsoft/callback?state=valid")).status, 400);
    assert.equal((await request("/schoolsoft/callback?state=wrong&code=code")).status, 400);
    assert.equal(
      (await request("/schoolsoft/callback?state=valid&code=code")).headers.get("location"),
      "/owner",
    );
    authenticated = true;
    assert.match(await (await request("/owner")).text(), /SchoolSoft: connected/);
    assert.equal(
      (await request("/owner/approve", { csrf, request: "bad", children: "999" })).status,
      400,
    );
    assert.equal((await request("/owner/approve", { csrf, request: "bad" })).status, 400);
    authenticated = false;
    assert.equal(
      (await request("/owner/approve", { csrf, request: "bad", children: "1" })).status,
      400,
    );
    assert.equal((await request("/owner/consent")).status, 400);
    broken = true;
    html = await (await request("/owner")).text();
    assert.ok(!html.includes("DO_NOT_EXPOSE"));
    broken = false;
    assert.equal((await request("/unknown")).status, 404);
    assert.equal((await request("/owner/schoolsoft/logout", { csrf })).status, 302);
    assert.ok(loggedOut);
    assert.equal((await request("/owner")).headers.get("location"), "/owner/login");
    const signedIn = await request(
      "/owner/login",
      { password: config.adminPassword },
      { "X-Forwarded-For": "192.0.2.12" },
    );
    cookie = signedIn.headers.get("set-cookie")!.split(";")[0];
    const signedInHtml = await (await request("/owner")).text();
    const signoutCsrf = signedInHtml.match(/name="csrf" value="([^"]+)"/)![1];
    const signout = await request("/owner/signout", { csrf: signoutCsrf });
    assert.equal(signout.status, 302);
    assert.match(signout.headers.get("set-cookie")!, /Expires=Thu, 01 Jan 1970/);
    assert.equal((await request("/owner")).headers.get("location"), "/owner/login");
    const resume = await request("/owner/login", {
      password: config.adminPassword,
      request: "opaque",
    });
    assert.equal(resume.headers.get("location"), "/owner/consent?request=opaque");
  } finally {
    server.close();
    server.closeAllConnections();
    await once(server, "close");
  }
});
