/**
 * The host probe over real HTTP, as Claude or ChatGPT would meet it: owner sign-in,
 * dynamic registration, consent, PKCE, a stateful MCP session with elicitation over
 * SSE, the step-up challenge and re-consent, the URL page behind the owner sign-in, and
 * the connector's hardening. Loopback only; no school portal is involved anywhere.
 */
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createServer, request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  ElicitRequestSchema,
  ElicitationCompleteNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createProbeApp } from "../../src/http/probe/app.js";
import { memoryLog } from "../../src/http/probe/log.js";

const PASSWORD = "synthetic-probe-password-0123456789-abcdef";
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const VERIFIER = "v".repeat(64);
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");

async function probe(t: TestContext, extra: { maxSessions?: number; failOn?: string } = {}) {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const clock = { t: Date.now() };
  const base = memoryLog("http", () => clock.t);
  const log = {
    ...base,
    record: (event: Parameters<typeof base.record>[0]) => {
      if (extra.failOn !== undefined && event.step === extra.failOn)
        throw new Error("synthetic log failure");
      base.record(event);
    },
  };
  const probeApp = createProbeApp({
    publicUrl: origin,
    proxyHops: 0,
    adminPassword: PASSWORD,
    log,
    now: () => clock.t,
    maxSessions: extra.maxSessions,
  });
  server.on("request", probeApp.app);
  const clients: Client[] = [];
  t.after(async () => {
    for (const client of clients) await client.close().catch(() => {});
    await probeApp.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const http = (path: string, init: RequestInit = {}) =>
    fetch(origin + path, { redirect: "manual", ...init });
  const post = (path: string, values: Record<string, string | string[]>, headers = {}) => {
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(values))
      for (const v of [value].flat()) body.append(key, v);
    return http(path, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: origin, ...headers },
      body,
    });
  };
  async function signIn(extraFields: Record<string, string> = {}) {
    const response = await post("/owner/login", { password: PASSWORD, ...extraFields });
    assert.equal(response.status, 302);
    const cookie = response.headers.get("set-cookie")!.split(";")[0];
    return { cookie, location: response.headers.get("location")! };
  }
  async function csrfOf(cookie: string, path = "/owner") {
    const html = await (await http(path, { headers: { Cookie: cookie } })).text();
    return html.match(/name="csrf" value="([^"]+)"/)![1];
  }
  async function register(name = "Claude") {
    const response = await http("/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: name,
        redirect_uris: [CALLBACK],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      }),
    });
    assert.equal(response.status, 201);
    return ((await response.json()) as { client_id: string }).client_id;
  }
  /** Authorize, consent with `approve`, exchange: what a host does on connect. */
  async function connect(
    clientId: string,
    cookie: string,
    { scope, approve }: { scope?: string; approve: string[] },
  ) {
    const query = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: CALLBACK,
      code_challenge: CHALLENGE,
      code_challenge_method: "S256",
      resource: origin + "/mcp",
      state: "s",
      // What a host following the MCP scope selection sends: the 401 carries no scope,
      // so it asks for everything in scopes_supported.
      scope: scope ?? "probe_read probe_step_up probe_step_up_meta",
    });
    const authorize = await http("/authorize?" + query);
    assert.equal(authorize.status, 302);
    const consentPath = authorize.headers.get("location")!;
    assert.match(consentPath, /^\/owner\/consent\?request=/);
    const consent = await (await http(consentPath, { headers: { Cookie: cookie } })).text();
    const csrf = consent.match(/name="csrf" value="([^"]+)"/)![1];
    const request = consent.match(/name="request" value="([^"]+)"/)![1];
    const approved = await post(
      "/owner/approve",
      { csrf, request, scopes: approve },
      { Cookie: cookie },
    );
    assert.equal(approved.status, 302);
    const code = new URL(approved.headers.get("location")!).searchParams.get("code")!;
    const token = await http("/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        code_verifier: VERIFIER,
        redirect_uri: CALLBACK,
        client_id: clientId,
        resource: origin + "/mcp",
      }),
    });
    assert.equal(token.status, 200);
    return { consent, ...((await token.json()) as { access_token: string; scope: string }) };
  }
  /** An MCP client whose bearer token can be swapped, as after a re-authorisation. */
  async function mcp(access: string, answer: "accept" | "decline" = "accept") {
    const bearer = { token: access };
    const transport = new StreamableHTTPClientTransport(new URL(origin + "/mcp"), {
      fetch: (url, init) => {
        const headers = new Headers(init?.headers);
        headers.set("Authorization", `Bearer ${bearer.token}`);
        return fetch(url, { ...init, headers });
      },
    });
    const client = new Client(
      { name: "probe-test-host", version: "1.2.3" },
      { capabilities: { elicitation: { form: {}, url: {} } } },
    );
    const urls: string[] = [];
    const completed: string[] = [];
    client.setRequestHandler(ElicitRequestSchema, async (request) => {
      if (request.params.mode === "url") urls.push(request.params.url);
      return answer === "accept" && request.params.mode !== "url"
        ? { action: "accept", content: { confirm: true } }
        : { action: answer };
    });
    client.setNotificationHandler(ElicitationCompleteNotificationSchema, (n) => {
      completed.push(n.params.elicitationId);
    });
    await client.connect(transport);
    clients.push(client);
    return { client, transport, bearer, urls, completed };
  }
  const raw = (path: string, headers: Record<string, string>) =>
    new Promise<number>((resolve, reject) => {
      const req = httpRequest(origin + path, { headers }, (res) => {
        res.resume();
        resolve(res.statusCode!);
      });
      req.on("error", reject);
      req.end();
    });
  return {
    origin,
    clock,
    log: base,
    http,
    post,
    signIn,
    csrfOf,
    register,
    connect,
    mcp,
    raw,
    sessions: probeApp.sessions,
    events: (name: string) => base.events.filter((e) => e.event === name),
  };
}
const text = (result: unknown) => (result as { content: { text: string }[] }).content[0].text;

test("the probe keeps the connector's hardening: headers, Host check, owner Origin and CSRF", async (t) => {
  const p = await probe(t);
  const health = await p.http("/healthz");
  assert.deepEqual(await health.json(), { ok: true, probe: true });
  assert.equal(health.headers.get("referrer-policy"), "same-origin");
  assert.equal(health.headers.get("x-content-type-options"), "nosniff");
  assert.equal(health.headers.get("cache-control"), "no-store");
  assert.match(health.headers.get("content-security-policy")!, /frame-ancestors 'none'/);
  assert.equal(health.headers.get("x-powered-by"), null);
  assert.equal(await p.raw("/owner", { Host: "evil.example" }), 421);
  assert.equal((await p.http("/")).headers.get("location"), "/owner");
  assert.equal((await p.http("/nowhere")).status, 404);
  assert.match(await (await p.http("/owner/login")).text(), /not your SchoolSoft connector/);
  const carried = await (await p.http("/owner/login?request=r2&next=/probe/elicit/x")).text();
  assert.match(carried, /name="request" value="r2"/);
  assert.match(carried, /name="next" value="\/probe\/elicit\/x"/);
  const malformed = await p.http("/owner/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: p.origin },
    body: "{",
  });
  assert.equal(malformed.status, 400, "a body the parser refuses is the caller's fault");
  assert.equal((await p.http("/owner")).headers.get("location"), "/owner/login");
  assert.equal(
    (await p.http("/owner/consent?request=r1")).headers.get("location"),
    "/owner/login?request=r1",
  );
  assert.equal(
    (await p.post("/owner/login", { password: PASSWORD }, { Origin: "https://evil.example" }))
      .status,
    403,
  );
  assert.equal((await p.post("/owner/login", { password: "wrong" })).status, 401);
  const { cookie, location } = await p.signIn();
  assert.equal(location, "/owner");
  const dashboard = await (await p.http("/owner", { headers: { Cookie: cookie } })).text();
  assert.equal((await p.http("/owner/consent", { headers: { Cookie: cookie } })).status, 400);
  assert.match(dashboard, /schoolsoft-agent probe/);
  assert.match(dashboard, /None yet/);
  assert.match(dashboard, /never contacts SchoolSoft/);
  const csrf = await p.csrfOf(cookie);
  assert.equal((await p.post("/owner/revoke-all", { csrf: "x" }, { Cookie: cookie })).status, 403);
  assert.equal((await p.post("/owner/revoke-all", {}, { Cookie: cookie })).status, 403);
  assert.equal(
    (await p.post("/owner/revoke-all", { csrf }, { Cookie: cookie, Origin: "null" })).status,
    403,
  );
  assert.equal((await p.post("/owner/revoke-all", { csrf }, { Cookie: cookie })).status, 302);
  assert.equal(
    (await p.signIn({ request: "abc" })).location,
    "/owner/consent?request=abc",
    "sign-in from a consent link returns to it",
  );
  assert.equal((await p.signIn({ next: "https://evil.example" })).location, "/owner");
  const out = await p.post("/owner/signout", { csrf }, { Cookie: cookie });
  assert.equal(out.headers.get("location"), "/owner/login");
  assert.equal((await p.http("/owner", { headers: { Cookie: cookie } })).status, 302);
  const logged = JSON.stringify(p.log.events);
  assert.ok(!logged.includes(PASSWORD) && !logged.includes(cookie.split("=")[1]));
  assert.ok(p.events("http").every((e) => !String(e.path).includes("?")));
});

test("a host connects with PKCE, sees every probe tool, and elicitation reaches it over SSE", async (t) => {
  const p = await probe(t);
  const metadata = (await (await p.http("/.well-known/oauth-protected-resource/mcp")).json()) as {
    scopes_supported: string[];
    resource_name: string;
  };
  assert.deepEqual(metadata.scopes_supported, [
    "probe_read",
    "probe_step_up",
    "probe_step_up_meta",
  ]);
  assert.equal(metadata.resource_name, "schoolsoft-agent probe");
  const unauthenticated = await p.http("/mcp", { method: "POST" });
  assert.equal(unauthenticated.status, 401);
  assert.match(unauthenticated.headers.get("www-authenticate")!, /resource_metadata=/);

  const { cookie } = await p.signIn();
  const clientId = await p.register();
  const { consent, access_token, scope } = await p.connect(clientId, cookie, {
    approve: ["probe_read"],
  });
  // Every advertised scope is offered, and only probe_read is ticked, the way write
  // scopes will be; the hidden one is not requested, so not shown.
  assert.match(consent, /value="probe_read" checked/);
  assert.match(consent, /value="probe_step_up">/);
  assert.match(consent, /value="probe_step_up_meta">/);
  assert.doesNotMatch(consent, /probe_step_up_hidden/);
  assert.equal(scope, "probe_read");
  const host = await p.mcp(access_token);
  const { tools } = await host.client.listTools();
  assert.equal(tools.length, 11);
  assert.equal(host.client.getServerVersion()?.name, "schoolsoft-agent probe");
  assert.equal(p.sessions(), 1);

  const form = await host.client.callTool({ name: "probe_elicit_form", arguments: {} });
  assert.match(text(form), /answered "accept" with "yes, send"/);
  const [init] = p.events("initialize");
  assert.equal(init.client, "probe-test-host");
  assert.equal(init.elicitationForm, true);
  assert.deepEqual(
    p.events("oauth").map((e) => e.step),
    ["register", "authorize", "consent", "token"],
  );
  const [registered] = p.events("oauth");
  assert.deepEqual(registered.callbackHosts, ["claude.ai"]);
  assert.deepEqual(p.events("oauth")[1].requestedScopes, [
    "probe_read",
    "probe_step_up",
    "probe_step_up_meta",
  ]);
  assert.equal(p.events("oauth")[3].grantType, "authorization_code");

  // The confirmation is bound to the grant: another app's grant cannot spend it.
  const preview = await host.client.callTool({
    name: "probe_confirmed_write",
    arguments: { date: "2026-09-28" },
  });
  const confirmation = (preview.structuredContent as { confirmation: string }).confirmation;
  const other = await p.connect(await p.register("ChatGPT"), cookie, { approve: ["probe_read"] });
  const stranger = await p.mcp(other.access_token);
  const refused = await stranger.client.callTool({
    name: "probe_confirmed_write",
    arguments: { date: "2026-09-28", confirmation },
  });
  assert.equal((refused.structuredContent as { reason: string }).reason, "invalid");
  const sent = await host.client.callTool({
    name: "probe_confirmed_write",
    arguments: { date: "2026-09-28", confirmation },
  });
  assert.equal((sent.structuredContent as { status: string }).status, "sent");
  const dashboard = await (await p.http("/owner", { headers: { Cookie: cookie } })).text();
  assert.match(dashboard, /Claude: probe_read/);
  assert.match(dashboard, /tool_call/);
});

test("a call without its scope gets the MCP step-up 403; re-consent carries the same session on", async (t) => {
  const p = await probe(t);
  const { cookie } = await p.signIn();
  const clientId = await p.register();
  const first = await p.connect(clientId, cookie, { scope: "probe_read", approve: ["probe_read"] });
  const host = await p.mcp(first.access_token);
  const challenged = await host.client
    .callTool({ name: "probe_step_up", arguments: {} })
    .catch((error: unknown) => error as Error);
  assert.ok(challenged instanceof Error);
  assert.match(challenged.message, /insufficient_scope/);
  // What the host saw, byte for byte.
  const direct = await p.http("/mcp", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${first.access_token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "mcp-session-id": host.transport.sessionId!,
    },
    body: JSON.stringify([
      { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "probe_step_up_hidden" } },
    ]),
  });
  assert.equal(direct.status, 403);
  assert.equal(
    direct.headers.get("www-authenticate"),
    `Bearer error="insufficient_scope", scope="probe_read probe_step_up_hidden", resource_metadata="${p.origin}/.well-known/oauth-protected-resource/mcp", error_description="The probe needs the probe_step_up_hidden permission"`,
  );
  // The result-challenge variant answers 200 with ChatGPT's documented _meta instead.
  const meta = await host.client.callTool({ name: "probe_step_up_meta", arguments: {} });
  assert.equal(meta.isError, true);
  assert.match(String(meta["_meta"]?.["mcp/www_authenticate"]), /insufficient_scope/);

  const second = await p.connect(clientId, cookie, {
    scope: "probe_read probe_step_up",
    approve: ["probe_read", "probe_step_up"],
  });
  host.bearer.token = second.access_token;
  const passed = await host.client.callTool({ name: "probe_step_up", arguments: {} });
  assert.match(text(passed), /carried the scope probe_step_up/);
  assert.deepEqual(
    p.events("step_up").map((e) => e.outcome),
    ["challenged_http_403", "challenged_http_403", "challenged_in_result", "passed"],
  );
  assert.deepEqual(
    p.events("session").map((e) => e.step),
    ["opened", "rebound_to_new_grant"],
  );
  assert.deepEqual(
    p
      .events("oauth")
      .filter((e) => e.step === "authorize")
      .map((e) => e.requestedScopes),
    [["probe_read"], ["probe_read", "probe_step_up"]],
  );
});

test("the URL page sits behind the owner sign-in, records whether the cookie came, and completes", async (t) => {
  const p = await probe(t);
  const { cookie } = await p.signIn();
  const { access_token } = await p.connect(await p.register(), cookie, { approve: ["probe_read"] });
  const host = await p.mcp(access_token);
  const answered = await host.client.callTool({ name: "probe_elicit_url", arguments: {} });
  assert.match(text(answered), /answered "accept"/);
  const path = new URL(host.urls[0]).pathname;
  const id = path.split("/").pop()!;

  // Opened by the host without the owner's cookie (SameSite=Strict on a cross-site link).
  const bounced = await p.http(path);
  assert.equal(bounced.headers.get("location"), `/owner/login?next=${encodeURIComponent(path)}`);
  assert.equal((await p.post(path, {})).status, 403);
  const login = await p.signIn({ next: path });
  assert.equal(login.location, path);
  const shown = await (await p.http(path, { headers: { Cookie: login.cookie } })).text();
  assert.match(shown, /Nothing here is real/);
  const csrf = shown.match(/name="csrf" value="([^"]+)"/)![1];
  assert.equal((await p.post(path, { csrf: "wrong" }, { Cookie: login.cookie })).status, 403);
  const done = await p.post(path, { csrf }, { Cookie: login.cookie });
  assert.equal(done.status, 200);
  assert.equal((await p.post(path, { csrf }, { Cookie: login.cookie })).status, 404);
  assert.equal(
    (await p.http("/probe/elicit/" + "x".repeat(43), { headers: { Cookie: login.cookie } })).status,
    404,
  );
  const deadline = Date.now() + 2000;
  while (!host.completed.length && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(host.completed, [id]);
  assert.deepEqual(
    p.events("url_page").map((e) => [e.stage, e.ownerCookie ?? null]),
    [
      ["sign_in_required", false],
      ["signed_in", true],
      ["opened", null],
      ["completed", null],
      ["unknown", null],
      ["signed_in", true],
      ["unknown", null],
    ],
  );
});

test("sessions are per app, bounded, expire when idle, and end with a revocation", async (t) => {
  const p = await probe(t, { maxSessions: 1 });
  const { cookie } = await p.signIn();
  const clientId = await p.register();
  const { access_token } = await p.connect(clientId, cookie, { approve: ["probe_read"] });
  const call = (headers: Record<string, string>, body: unknown, method = "POST") =>
    p.http("/mcp", {
      method,
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...headers,
      },
      body: method === "POST" ? JSON.stringify(body) : undefined,
    });
  const list = { jsonrpc: "2.0", id: 1, method: "tools/list" };
  assert.equal((await call({}, list)).status, 400, "no session and not an initialize");
  assert.equal((await call({}, [list])).status, 400);
  assert.equal((await call({}, undefined, "GET")).status, 400);
  assert.equal((await call({ "mcp-session-id": "nope" }, list)).status, 404);
  assert.equal((await call({ Origin: "https://evil.example" }, list)).status, 403);

  const first = await p.mcp(access_token);
  const other = await p.connect(await p.register("Other"), cookie, { approve: ["probe_read"] });
  const foreign = await p.http("/mcp", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${other.access_token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "mcp-session-id": first.transport.sessionId!,
    },
    body: JSON.stringify(list),
  });
  assert.equal(foreign.status, 404, "another app cannot use this app's session");

  await p.mcp(access_token);
  assert.equal(p.sessions(), 1, "the older session made room");
  p.clock.t += 31 * 60_000;
  // The owner's own sign-in lasted 30 minutes too.
  const { cookie: again } = await p.signIn();
  const fresh = await p.connect(clientId, again, { approve: ["probe_read"] });
  await p.mcp(fresh.access_token);
  const steps = new Set(p.events("session").map((e) => e.step));
  assert.ok(steps.has("evicted") && steps.has("idle"));

  const csrf = await p.csrfOf(again);
  const grant = (await (await p.http("/owner", { headers: { Cookie: again } })).text()).match(
    /name="grant" value="([^"]+)"/,
  )![1];
  assert.equal((await p.post("/owner/revoke", { csrf, grant }, { Cookie: again })).status, 302);
  await p.post("/owner/revoke-all", { csrf }, { Cookie: again });
  assert.equal(p.sessions(), 0);
  assert.equal((await call({}, list)).status, 401, "revoked tokens no longer work");
});

test("faults show fixed pages; refused scopes and bad registrations are recorded", async (t) => {
  const p = await probe(t, { failOn: "deny" });
  const { cookie } = await p.signIn();
  const clientId = await p.register();
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: CALLBACK,
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    resource: p.origin + "/mcp",
    scope: "probe_step_up",
  });
  const consentPath = (await p.http("/authorize?" + query)).headers.get("location")!;
  const csrf = await p.csrfOf(cookie, consentPath);
  const request = new URLSearchParams(consentPath.split("?")[1]).get("request")!;
  const faulted = await p.post("/owner/deny", { csrf, request }, { Cookie: cookie });
  assert.equal(faulted.status, 500, "a fault on this side shows the fixed error page");
  assert.match(await faulted.text(), /The probe had a problem/);
  const invalid = await p.post(
    "/owner/approve",
    { csrf, request, scopes: "probe_read" },
    { Cookie: cookie },
  );
  assert.equal(invalid.status, 400, "a scope the app did not ask for is refused");
  const none = await p.post("/owner/approve", { csrf, request }, { Cookie: cookie });
  assert.equal(none.status, 400, "at least one scope");
  assert.match(await invalid.text(), /Could not complete this step/);
  const bad = await p.http("/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ redirect_uris: ["not a url"] }),
  });
  assert.equal(bad.status, 400);
  assert.deepEqual(p.events("oauth").at(-1)?.callbackHosts, ["invalid"]);
  assert.equal(p.events("oauth").at(-1)?.clientName, "");
  const token = await p.http("/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "",
  });
  assert.equal(token.status, 400);
  assert.deepEqual(
    [p.events("oauth").at(-1)?.step, p.events("oauth").at(-1)?.grantType],
    ["token", ""],
  );
});

test("a grant without probe_read is challenged for it; consent can be denied; a host can end its session", async (t) => {
  const p = await probe(t);
  const { cookie } = await p.signIn();
  const clientId = await p.register();
  const stepOnly = await p.connect(clientId, cookie, {
    scope: "probe_step_up",
    approve: ["probe_step_up"],
  });
  const refused = await p.http("/mcp", {
    method: "POST",
    headers: { Authorization: `Bearer ${stepOnly.access_token}` },
  });
  assert.equal(refused.status, 403);
  assert.match(refused.headers.get("www-authenticate")!, /insufficient_scope/);
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: CALLBACK,
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    resource: p.origin + "/mcp",
  });
  // Without a scope parameter the connector's provider refuses, and so does the probe.
  const noScope = (await p.http("/authorize?" + query)).headers.get("location")!;
  assert.match(noScope, /^https:\/\/claude\.ai\/.*error=invalid_scope/);
  assert.equal(p.events("oauth").at(-1)?.requestedScopes, null);
  query.set("scope", "probe_read probe_step_up_hidden");
  const consentPath = (await p.http("/authorize?" + query)).headers.get("location")!;
  assert.match(
    await (await p.http(consentPath, { headers: { Cookie: cookie } })).text(),
    /probe_step_up_hidden \(not advertised\)/,
  );
  const csrf = await p.csrfOf(cookie, consentPath);
  const request = new URLSearchParams(consentPath.split("?")[1]).get("request")!;
  const denied = await p.post("/owner/deny", { csrf, request }, { Cookie: cookie });
  assert.match(denied.headers.get("location")!, /error=access_denied/);
  const { access_token } = await p.connect(clientId, cookie, { approve: ["probe_read"] });
  const host = await p.mcp(access_token);
  await host.transport.terminateSession();
  assert.deepEqual(
    p.events("session").map((e) => e.step),
    ["opened", "closed_by_host"],
  );
  assert.equal(p.sessions(), 0);
});
