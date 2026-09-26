import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { connectorConfig } from "../../src/http/config.js";
import { ConnectorOAuthProvider } from "../../src/http/oauth.js";
import { createConnectorApp } from "../../src/http/server.js";
import { OwnerSessions } from "../../src/http/owner-session.js";
import { InputError, type PortalHealth } from "../../src/core/index.js";
const config = connectorConfig({
  SCHOOLSOFT_PUBLIC_URL: "https://connector.example",
  SCHOOLSOFT_ADMIN_PASSWORD: "synthetic-admin-password-0123456789",
  // This suite plays one reverse proxy: X-Forwarded-For names the caller.
  SCHOOLSOFT_PROXY_HOPS: "1",
  SCHOOLSOFT_STORAGE_KEY: "a".repeat(64),
  SCHOOLSOFT_SCHOOL: "example",
});
test("owner console enforces host, password, session, origin and CSRF and completes manual login routes", async () => {
  let loginError: "expired" | undefined;
  let portal: PortalHealth = { state: "ok", retryAt: null };
  let authenticated = false,
    pending = false,
    broken = false,
    loggedOut = false,
    loginBusy = false;
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
          portal,
        };
      },
      beginLogin: async () => {
        if (loginBusy) throw new InputError("A login is already in progress.");
        return { url: "https://school.example/login?state=private&foo=1" };
      },
      callback: (state, code) => state === "valid" && code === "code",
      logout: async () => {
        loggedOut = true;
      },
      execute: async () => ({}),
      executeForChild: () => Promise.reject(new Error("the overview is not under test here")),
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
    raw?: string,
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
      req.end(raw ?? (body ? new URLSearchParams(body).toString() : undefined));
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
      (await request("/owner/schoolsoft/login", { csrf: "x".repeat(csrf.length) })).status,
      403,
    );
    assert.equal(
      (await request("/owner/schoolsoft/login", {}, {}, `csrf=${csrf}&csrf=${csrf}`)).status,
      403,
      "a repeated field is not a token",
    );
    assert.match(html, /appears to come from <code>127\.0\.0\.1<\/code>/);
    assert.match(
      await (await request("/owner", undefined, { "X-Forwarded-For": "198.51.100.9" })).text(),
      /appears to come from <code>198\.51\.100\.9<\/code>/,
    );
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
    // The request budget's breaker: one line while the portal pushes back, nothing otherwise.
    assert.doesNotMatch(await (await request("/owner")).text(), /pushing back/);
    portal = { state: "paused", retryAt: "2026-09-26T12:05:00.000Z" };
    assert.match(
      await (await request("/owner")).text(),
      /SchoolSoft is pushing back \(paused\): the connector sends it nothing until 2026-09-26T12:05:00\.000Z \(UTC\)\. Signing in again does not help/,
    );
    portal = { state: "probing", retryAt: null };
    assert.match(
      await (await request("/owner")).text(),
      /nothing until one request has tested whether it answers again/,
    );
    portal = { state: "ok", retryAt: null };
    // Endpoint middleware bounds both password and upstream login attempts per caller.
    for (let i = 0; i < 20; i++)
      assert.equal(
        (await request("/owner/login", { password: "wrong" }, { "X-Forwarded-For": "192.0.2.20" }))
          .status,
        401,
      );
    const limited = await request(
      "/owner/login",
      { password: "wrong" },
      { "X-Forwarded-For": "192.0.2.20" },
    );
    assert.equal(limited.status, 429);
    assert.ok(limited.headers.has("retry-after"));
    // The flood guard never keeps the owner out, even from the flooding address.
    assert.equal(
      (
        await request(
          "/owner/login",
          { password: config.adminPassword },
          { "X-Forwarded-For": "192.0.2.20" },
        )
      ).status,
      302,
    );
    assert.equal(
      (await request("/owner/login", { password: "wrong" }, { "X-Forwarded-For": "192.0.2.20" }))
        .status,
      429,
    );
    // Rotating through one IPv6 /64 spends one budget; the neighbouring /64 has its own.
    for (let i = 0; i < 20; i++)
      assert.equal(
        (
          await request(
            "/owner/login",
            { password: "wrong" },
            { "X-Forwarded-For": `2001:db8:5:5::${(i + 1).toString(16)}` },
          )
        ).status,
        401,
      );
    assert.equal(
      (
        await request(
          "/owner/login",
          { password: "wrong" },
          { "X-Forwarded-For": "2001:db8:5:5:ffff::1" },
        )
      ).status,
      429,
    );
    assert.equal(
      (
        await request(
          "/owner/login",
          { password: "wrong" },
          { "X-Forwarded-For": "2001:db8:5:6::1" },
        )
      ).status,
      401,
    );
    for (let i = 0; i < 20; i++)
      assert.equal(
        (await request("/owner/schoolsoft/login", { csrf }, { "X-Forwarded-For": "192.0.2.21" }))
          .status,
        200,
      );
    assert.equal(
      (await request("/owner/schoolsoft/login", { csrf }, { "X-Forwarded-For": "192.0.2.21" }))
        .status,
      429,
    );
    assert.equal(
      (await request("/owner/schoolsoft/login", { csrf }, { "X-Forwarded-For": "192.0.2.22" }))
        .status,
      200,
    );
    // The unauthenticated portal callback has its own per-caller budget for state guesses.
    const guesser = { "X-Forwarded-For": "192.0.2.30" };
    for (let i = 0; i < 20; i++)
      assert.equal(
        (await request("/schoolsoft/callback?state=guess&code=code", undefined, guesser)).status,
        400,
      );
    const guessLimited = await request(
      "/schoolsoft/callback?state=valid&code=code",
      undefined,
      guesser,
    );
    assert.equal(guessLimited.status, 429);
    assert.ok(guessLimited.headers.has("retry-after"));
    assert.equal(
      (await request("/owner/login", { password: "wrong" }, guesser)).status,
      401,
      "callback guesses do not spend the owner login budget",
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
    // Internal faults are 500 with a fixed body; caller mistakes stay 400.
    broken = true;
    response = await request("/owner");
    html = await response.text();
    assert.equal(response.status, 500);
    assert.match(html, /The connector had a problem/);
    assert.ok(!html.includes("DO_NOT_EXPOSE"));
    broken = false;
    const malformed = await request(
      "/owner/login",
      {},
      { "Content-Type": "application/json" },
      "{not json",
    );
    assert.equal(malformed.status, 400);
    assert.doesNotMatch(await malformed.text(), /not json|SyntaxError/);
    loginBusy = true;
    assert.equal((await request("/owner/schoolsoft/login", { csrf })).status, 400);
    loginBusy = false;
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

test("without a declared proxy, forwarding headers are ignored and the operator is told once", async (t) => {
  const direct = connectorConfig({
    SCHOOLSOFT_PUBLIC_URL: "https://connector.example",
    SCHOOLSOFT_ADMIN_PASSWORD: "synthetic-admin-password-0123456789",
    SCHOOLSOFT_STORAGE_KEY: "a".repeat(64),
    SCHOOLSOFT_SCHOOL: "example",
  });
  assert.equal(direct.proxyHops, 0);
  const stderr = t.mock.method(process.stderr, "write", () => true);
  const notices: string[] = [];
  for (const warn of [(message: string) => void notices.push(message), undefined]) {
    const app = createConnectorApp({
      config: direct,
      warn,
      oauth: new ConnectorOAuthProvider({
        resourceUrl: direct.publicUrl + "/mcp",
        scopes: ["list_children"],
        repository: { read: () => undefined, write: () => {} },
      }),
      runtime: {
        status: async () => ({
          authenticated: false,
          loginInProgress: false,
          children: [],
          portal: { state: "ok" as const, retryAt: null },
        }),
        beginLogin: async () => ({ url: "https://school.example/login" }),
        callback: () => false,
        logout: async () => {},
        execute: async () => ({}),
        executeForChild: () => Promise.reject(new Error("the overview is not under test here")),
      },
    });
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const guess = (forwarded?: string): Promise<number> =>
      new Promise((resolve, reject) => {
        const req = httpRequest(
          `http://127.0.0.1:${(server.address() as AddressInfo).port}/owner/login`,
          {
            method: "POST",
            headers: {
              Host: "connector.example",
              Origin: direct.publicUrl,
              "Content-Type": "application/x-www-form-urlencoded",
              ...(forwarded ? { "X-Forwarded-For": forwarded } : {}),
            },
          },
          (res) => {
            res.resume();
            res.on("end", () => resolve(res.statusCode!));
          },
        );
        req.on("error", reject);
        req.end("password=wrong");
      });
    try {
      assert.equal(await guess(), 401);
      assert.equal(notices.length + stderr.mock.callCount(), warn ? 0 : 1);
      // A spoofed, changing header buys no fresh budget: all of these share the socket address.
      for (let i = 1; i < 20; i++) assert.equal(await guess(`198.51.100.${i}`), 401);
      assert.equal(await guess("198.51.100.200"), 429);
    } finally {
      server.close();
      server.closeAllConnections();
      await once(server, "close");
    }
  }
  assert.equal(notices.length, 1, "one notice, not one per request");
  assert.match(notices[0], /SCHOOLSOFT_PROXY_HOPS is 0/);
  assert.doesNotMatch(notices[0], /198\.51\.100/);
  assert.equal(stderr.mock.callCount(), 1);
  assert.match(String(stderr.mock.calls[0].arguments[0]), /SCHOOLSOFT_PROXY_HOPS is 0/);
});
