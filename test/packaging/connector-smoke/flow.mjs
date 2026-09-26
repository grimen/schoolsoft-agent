/** Scripted owner + OAuth + MCP acceptance flow against a running connector whose
 * upstream is fake-upstream.mjs. Everything goes over real HTTP to `base`; the login
 * link the connector shows is only parsed for its state, never opened.
 *
 * In-process: test/functional/http-connector-flow.test.ts. Against the Docker image:
 * test/packaging/connector-flow-container.mjs (make connector-smoke).
 * Plain ESM without dependencies so the production image can run it.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { FAKE_GUARDIAN, FAKE_LUNCH_DISH, FAKE_UPSTREAM_CODE } from "./fake-upstream.mjs";

const CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const [ALLOWED, OTHER] = FAKE_GUARDIAN.children;

/**
 * @param {{ base: string, origin: string, adminPassword: string, log?: (step: string) => void }} options
 * `base` is where the listener is reachable (http://127.0.0.1:<port>); `origin` is the
 * connector's configured public HTTPS origin, sent as Host and Origin.
 */
export async function runConnectorFlow({ base, origin, adminPassword, log = () => {} }) {
  const steps = [];
  const step = (name) => {
    steps.push(name);
    log(name);
  };
  const resource = origin + "/mcp";
  let cookie = "";

  const request = (path, { method = "GET", headers = {}, body } = {}) =>
    new Promise((resolve, reject) => {
      const req = httpRequest(
        base + path,
        { method, headers: { Host: new URL(origin).host, ...headers } },
        (res) => {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () =>
            resolve({
              status: res.statusCode,
              headers: res.headers,
              text: Buffer.concat(chunks).toString(),
            }),
          );
        },
      );
      req.on("error", reject);
      req.end(body);
    });
  const form = (path, values, headers = {}) =>
    request(path, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: origin, ...headers },
      body: new URLSearchParams(values).toString(),
    });
  const owner = (path) => request(path, { headers: { Cookie: cookie } });
  const ownerForm = (path, values) => form(path, values, { Cookie: cookie });
  const json = (response) => JSON.parse(response.text);
  const rpc = async (token, method, params) => {
    const response = await request("/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (response.status !== 200) return { status: response.status };
    const payload = response.text.startsWith("event:")
      ? response.text
          .split("\n")
          .find((line) => line.startsWith("data:"))
          .slice(5)
      : response.text;
    return { status: 200, data: JSON.parse(payload) };
  };
  const call = (token, name, args = {}) =>
    rpc(token, "tools/call", { name: "schoolsoft_" + name, arguments: args });
  const refused = (result) => Boolean(result.data?.error || result.data?.result?.isError);
  const toolNames = async (token) =>
    (await rpc(token, "tools/list")).data.result.tools.map((tool) => tool.name).sort();
  const refresh = (clientId, refreshToken, extra = {}) =>
    form("/token", {
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: refreshToken,
      resource,
      ...extra,
    });

  // --- Discovery -----------------------------------------------------------
  assert.equal((await request("/healthz")).status, 200);
  const as = json(await request("/.well-known/oauth-authorization-server"));
  assert.equal(as.issuer, origin + "/");
  assert.equal(as.authorization_endpoint, origin + "/authorize");
  assert.equal(as.token_endpoint, origin + "/token");
  assert.equal(as.registration_endpoint, origin + "/register");
  assert.deepEqual(as.code_challenge_methods_supported, ["S256"]);
  assert.ok(as.grant_types_supported.includes("refresh_token"));
  const pr = json(await request("/.well-known/oauth-protected-resource/mcp"));
  assert.equal(pr.resource, resource);
  assert.deepEqual(pr.authorization_servers, [origin + "/"]);
  assert.ok(pr.scopes_supported.includes("get_calendar"));
  const anonymous = await request("/mcp", { method: "POST" });
  assert.equal(anonymous.status, 401);
  assert.match(
    anonymous.headers["www-authenticate"],
    /resource_metadata="[^"]+oauth-protected-resource\/mcp"/,
  );
  assert.equal((await request("/healthz", { headers: { Host: "rebound.example" } })).status, 200);
  assert.equal((await request("/owner", { headers: { Host: "rebound.example" } })).status, 421);
  step("discovery metadata, anonymous challenge and host pinning");

  // --- Owner login ---------------------------------------------------------
  assert.equal((await form("/owner/login", { password: adminPassword + "x" })).status, 401);
  assert.equal(
    (await form("/owner/login", { password: adminPassword }, { Origin: "https://evil.example" }))
      .status,
    403,
  );
  const login = await form("/owner/login", { password: adminPassword });
  assert.equal(login.status, 302);
  const setCookie = login.headers["set-cookie"][0];
  for (const flag of [
    /^__Host-owner=/,
    /; Path=\/(;|$)/,
    /; HttpOnly/,
    /; Secure/,
    /; SameSite=Strict/,
  ])
    assert.match(setCookie, flag);
  assert.doesNotMatch(setCookie, /; Domain=/i);
  cookie = setCookie.split(";")[0];
  let dashboard = await owner("/owner");
  assert.match(dashboard.text, /SchoolSoft: not connected/);
  const csrf = /name="csrf" value="([^"]+)"/.exec(dashboard.text)[1];
  step("owner login with a hardened session cookie");

  // --- Upstream sign-in: the parent's browser step is simulated, never opened.
  assert.equal((await ownerForm("/owner/schoolsoft/login", { csrf: "wrong" })).status, 403);
  const begin = await ownerForm("/owner/schoolsoft/login", { csrf });
  assert.equal(begin.status, 200);
  const link = /<a href="([^"]+)" rel="noreferrer">/.exec(begin.text)[1].replaceAll("&amp;", "&");
  const state = /[?&#]state=([^&#]+)/.exec(link)[1];
  assert.ok(link.includes(encodeURIComponent(origin + "/schoolsoft/callback")));
  assert.equal(
    (
      await request(
        `/schoolsoft/callback?state=${"A".repeat(state.length)}&code=${FAKE_UPSTREAM_CODE}`,
      )
    ).status,
    400,
  );
  const returned = await request(`/schoolsoft/callback?state=${state}&code=${FAKE_UPSTREAM_CODE}`);
  assert.equal(returned.status, 302);
  assert.equal(
    (await request(`/schoolsoft/callback?state=${state}&code=${FAKE_UPSTREAM_CODE}`)).status,
    400,
    "upstream callback state is one-use",
  );
  for (let attempt = 0; ; attempt++) {
    dashboard = await owner("/owner");
    if (/SchoolSoft: connected/.test(dashboard.text)) break;
    assert.ok(attempt < 50, "upstream sign-in did not complete");
    await delay(100);
  }
  step("upstream sign-in through the public callback (simulated browser)");

  // --- Registration and authorization --------------------------------------
  const register = (name, redirect = CALLBACK) =>
    request("/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: name,
        redirect_uris: [redirect],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      }),
    });
  assert.equal((await register("Hostile", "https://evil.example/callback")).status, 400);
  assert.equal(
    (await register("Lookalike", "https://claude.ai.evil.example/api/mcp/auth_callback")).status,
    400,
  );

  async function connect(name, scopes, children) {
    const registered = await register(name);
    assert.equal(registered.status, 201);
    const clientId = json(registered).client_id;
    const verifier = randomBytes(48).toString("base64url");
    const oauthState = randomBytes(16).toString("base64url");
    const query = {
      client_id: clientId,
      response_type: "code",
      redirect_uri: CALLBACK,
      resource,
      state: oauthState,
      scope: scopes.join(" "),
    };
    const s256 = {
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    };
    // PKCE is mandatory and S256-only; neither variant may reach the consent page.
    for (const weak of [{}, { code_challenge: verifier, code_challenge_method: "plain" }]) {
      const rejected = await request("/authorize?" + new URLSearchParams({ ...query, ...weak }));
      assert.equal(rejected.status, 302);
      const target = new URL(rejected.headers.location, origin);
      assert.equal(target.origin + target.pathname, CALLBACK);
      assert.equal(target.searchParams.get("error"), "invalid_request");
    }
    const foreign = await request(
      "/authorize?" +
        new URLSearchParams({ ...query, ...s256, redirect_uri: "https://evil.example/callback" }),
    );
    assert.equal(foreign.status, 400, "an unregistered redirect_uri is never redirected to");
    const authorized = await request("/authorize?" + new URLSearchParams({ ...query, ...s256 }));
    assert.equal(authorized.status, 302);
    const consentPath = authorized.headers.location;
    assert.match(consentPath, /^\/owner\/consent\?request=/);
    const anonymousConsent = await request(consentPath);
    assert.equal(anonymousConsent.status, 302);
    assert.match(anonymousConsent.headers.location, /^\/owner\/login\?request=/);
    const consent = await owner(consentPath);
    assert.equal(consent.status, 200);
    assert.ok(consent.text.includes(name));
    for (const child of FAKE_GUARDIAN.children) assert.ok(consent.text.includes(child.firstName));
    const id = new URL(consentPath, origin).searchParams.get("request");
    const approval = new URLSearchParams([
      ["request", id],
      ...children.map((child) => ["children", String(child)]),
      ...scopes.map((scope) => ["scopes", scope]),
    ]);
    assert.equal((await ownerForm("/owner/approve", approval)).status, 403, "CSRF token required");
    approval.set("csrf", csrf);
    const approved = await ownerForm("/owner/approve", approval);
    assert.equal(approved.status, 302);
    const back = new URL(approved.headers.location);
    assert.equal(back.origin + back.pathname, CALLBACK);
    assert.equal(back.searchParams.get("state"), oauthState);
    const code = back.searchParams.get("code");
    const exchange = (codeVerifier) =>
      form("/token", {
        grant_type: "authorization_code",
        client_id: clientId,
        code,
        code_verifier: codeVerifier,
        redirect_uri: CALLBACK,
        resource,
      });
    const wrongVerifier = await exchange(randomBytes(48).toString("base64url"));
    assert.equal(wrongVerifier.status, 400);
    assert.equal(json(wrongVerifier).error, "invalid_grant");
    const exchanged = await exchange(verifier);
    assert.equal(exchanged.status, 200);
    const tokens = json(exchanged);
    assert.equal(tokens.token_type, "Bearer");
    assert.equal(tokens.scope, scopes.join(" "));
    return { clientId, tokens, replayCode: () => exchange(verifier) };
  }

  const limitedScopes = ["list_children", "get_schedule", "get_lunch_menu"];
  const limited = await connect("Smoke limited app", limitedScopes, [ALLOWED.studentId]);
  step("registration, S256-only PKCE, owner consent and code exchange");

  // --- MCP under a limited grant -------------------------------------------
  const initialized = await rpc(limited.tokens.access_token, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "connector-smoke", version: "1" },
  });
  assert.equal(initialized.status, 200);
  assert.equal(initialized.data.result.serverInfo.name, "schoolsoft-agent");
  assert.deepEqual(
    await toolNames(limited.tokens.access_token),
    limitedScopes.map((scope) => "schoolsoft_" + scope).sort(),
  );
  const children = await call(limited.tokens.access_token, "list_children");
  assert.ok(!refused(children));
  assert.deepEqual(JSON.parse(children.data.result.content[0].text).children, [
    { id: ALLOWED.studentId, firstName: ALLOWED.firstName },
  ]);
  const lunch = await call(limited.tokens.access_token, "get_lunch_menu", { week: 37 });
  assert.ok(!refused(lunch));
  const menu = JSON.parse(lunch.data.result.content[0].text);
  assert.equal(menu.week, 37);
  assert.equal(menu.days[0].dishes[0].description, FAKE_LUNCH_DISH);
  const schedule = await call(limited.tokens.access_token, "get_schedule", { week: 37 });
  assert.ok(!refused(schedule));
  assert.match(
    schedule.data.result.content[0].text,
    new RegExp(`"note":"servedForChild=${ALLOWED.studentId}"`),
  );
  step("tools/list and tool calls return the fake portal's data");

  const otherChild = await call(limited.tokens.access_token, "get_schedule", {
    week: 37,
    child_id: OTHER.studentId,
  });
  assert.ok(refused(otherChild), "unapproved child must be refused");
  assert.doesNotMatch(JSON.stringify(otherChild.data), /Synthetic lesson|Synthetic Bo/);
  const calendarArgs = { start_date: "2026-09-07", end_date: "2026-09-13" };
  assert.ok(refused(await call(limited.tokens.access_token, "get_calendar", calendarArgs)));
  const upgrade = await refresh(limited.clientId, limited.tokens.refresh_token, {
    scope: [...limitedScopes, "get_calendar"].join(" "),
  });
  assert.equal(upgrade.status, 400);
  assert.equal(json(upgrade).error, "invalid_scope");
  step("per-child denial and calendar scope limit, including via refresh");

  // --- Refresh rotation ----------------------------------------------------
  const rotatedResponse = await refresh(limited.clientId, limited.tokens.refresh_token);
  assert.equal(rotatedResponse.status, 200);
  const rotated = json(rotatedResponse);
  assert.notEqual(rotated.refresh_token, limited.tokens.refresh_token);
  assert.notEqual(rotated.access_token, limited.tokens.access_token);
  assert.deepEqual(
    await toolNames(rotated.access_token),
    limitedScopes.map((scope) => "schoolsoft_" + scope).sort(),
  );
  const replayed = await refresh(limited.clientId, limited.tokens.refresh_token);
  assert.equal(replayed.status, 400);
  assert.equal(json(replayed).error, "invalid_grant");
  // Replay is treated as theft: the whole grant is withdrawn, including the newest tokens.
  assert.equal((await rpc(rotated.access_token, "tools/list")).status, 401);
  assert.equal((await refresh(limited.clientId, rotated.refresh_token)).status, 400);
  step("refresh rotation; a replayed refresh token is rejected and withdraws the grant");

  // --- Full grant, then revocation from the owner dashboard -----------------
  const fullScopes = [...limitedScopes, "get_calendar"];
  const full = await connect(
    "Smoke full app",
    fullScopes,
    FAKE_GUARDIAN.children.map((c) => c.studentId),
  );
  const calendar = await call(full.tokens.access_token, "get_calendar", {
    ...calendarArgs,
    child_id: OTHER.studentId,
  });
  assert.ok(!refused(calendar), "a grant that includes the calendar scope and child may read it");
  assert.match(calendar.data.result.content[0].text, /Synthetic school event/);
  dashboard = await owner("/owner");
  assert.ok(dashboard.text.includes("Smoke full app"));
  assert.ok(!dashboard.text.includes("Smoke limited app"), "withdrawn grants leave the dashboard");
  const grants = [...dashboard.text.matchAll(/name="grant" value="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(grants.length, 1);
  assert.equal((await ownerForm("/owner/revoke", { grant: grants[0] })).status, 403);
  assert.equal((await rpc(full.tokens.access_token, "tools/list")).status, 200);
  assert.equal((await ownerForm("/owner/revoke", { csrf, grant: grants[0] })).status, 302);
  assert.equal((await rpc(full.tokens.access_token, "tools/list")).status, 401);
  assert.equal((await refresh(full.clientId, full.tokens.refresh_token)).status, 400);
  assert.ok(!(await owner("/owner")).text.includes("Smoke full app"));
  step("dashboard revocation cuts off access and refresh immediately");

  // --- Authorization code replay ------------------------------------------------
  const codeReplay = await connect("Smoke replay app", limitedScopes, [ALLOWED.studentId]);
  assert.equal((await rpc(codeReplay.tokens.access_token, "tools/list")).status, 200);
  const secondUse = await codeReplay.replayCode();
  assert.equal(secondUse.status, 400);
  assert.equal(json(secondUse).error, "invalid_grant");
  assert.equal((await rpc(codeReplay.tokens.access_token, "tools/list")).status, 401);
  assert.equal((await refresh(codeReplay.clientId, codeReplay.tokens.refresh_token)).status, 400);
  step("a codeReplay authorization code withdraws the tokens issued from it");

  // --- Owner login throttling (own forwarded address; the owner stays usable) --
  const attacker = { "X-Forwarded-For": "198.51.100.77" };
  let limitedAt = 0;
  for (let attempt = 1; attempt <= 25 && !limitedAt; attempt++) {
    const response = await form("/owner/login", { password: "guess-" + attempt }, attacker);
    if (response.status === 429) {
      assert.ok(response.headers["retry-after"]);
      limitedAt = attempt;
    } else assert.equal(response.status, 401);
  }
  assert.equal(limitedAt, 21, "the 21st attempt within a minute is rate limited");
  const ownerFromThere = await form("/owner/login", { password: adminPassword }, attacker);
  assert.equal(ownerFromThere.status, 302, "the flood guard never refuses the correct password");
  assert.equal((await form("/owner/login", { password: "guess-again" }, attacker)).status, 429);
  assert.equal((await owner("/owner")).status, 200);
  step("owner login rate limit answers 429 with Retry-After, yet admits the owner");

  // --- Sign-out --------------------------------------------------------------
  const signout = await ownerForm("/owner/signout", { csrf });
  assert.equal(signout.status, 302);
  assert.match(signout.headers["set-cookie"][0], /^__Host-owner=;/);
  assert.equal((await owner("/owner")).status, 302);
  step("owner sign-out invalidates the dashboard session");
  return { steps };
}

/* Direct use: node flow.mjs (the container smoke runs it inside the image). */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const {
    CONNECTOR_BASE: base,
    SCHOOLSOFT_PUBLIC_URL: origin,
    SCHOOLSOFT_ADMIN_PASSWORD: adminPassword,
  } = process.env;
  assert.ok(
    base && origin && adminPassword,
    "CONNECTOR_BASE, SCHOOLSOFT_PUBLIC_URL and SCHOOLSOFT_ADMIN_PASSWORD are required",
  );
  const { steps } = await runConnectorFlow({
    base,
    origin: new URL(origin).origin,
    adminPassword,
    log: (name) => console.log("ok - " + name),
  });
  console.log(`Connector flow passed: ${steps.length} stages.`);
}
