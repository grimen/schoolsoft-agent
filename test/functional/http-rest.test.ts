/** The REST surface over real HTTP: the real OAuth provider, the real runtime and
 * provider, and the fake portal from the connector smoke at the injected fetch seam.
 * Tokens come from the ordinary owner consent flow; nothing is minted behind its back.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { test, type TestContext } from "node:test";
import {
  MemoryPendingLoginStore,
  MemorySessionHistoryStore,
  MemorySessionStore,
  getOperation,
  resolveConfig,
  createRequestBudget,
  type Lang,
  type RequestBudget,
} from "../../src/core/index.js";
import { CountingBudget, FakeClock } from "../helpers/budget.js";
import type { ConnectorConfig } from "../../src/http/config.js";
import { ConnectorOAuthProvider, type OAuthState } from "../../src/http/oauth.js";
import { CONNECTOR_OPERATIONS, ConnectorRuntime } from "../../src/http/runtime.js";
import { REST_REQUESTS_PER_MINUTE } from "../../src/http/rest.js";
import { createConnectorApp } from "../../src/http/server.js";
import {
  FAKE_GUARDIAN,
  FAKE_LUNCH_DISH,
  FAKE_UPSTREAM_CODE,
  FAKE_UPSTREAM_SECRETS,
  fakeUpstream,
} from "../packaging/connector-smoke/fake-upstream.mjs";

const origin = "https://connector.example";
const resource = origin + "/mcp";
const callback = "https://claude.ai/api/mcp/auth_callback";
const verifier = "v".repeat(64);
const challenge = createHash("sha256").update(verifier).digest("base64url");
const ALL = [...CONNECTOR_OPERATIONS];
const [ALVA, BO] = FAKE_GUARDIAN.children.map((child) => child.studentId);
const CSP =
  "default-src 'none'; form-action 'self' https://claude.ai https://chatgpt.com; frame-ancestors 'none'; base-uri 'none'";

interface Reply {
  status: number;
  headers: Headers;
  text: string;
  json: () => Record<string, unknown>;
}
type UpstreamReply = { status: number; data: unknown; headers: object; setCookies: string[] };

async function fixture(
  t: TestContext,
  options: { lang?: Lang; proxyHops?: number; budget?: RequestBudget; now?: () => number } = {},
) {
  let clock = Date.now();
  const upstream = fakeUpstream();
  /** Runs before every upstream request; may answer instead of the fake portal. */
  let intercept: ((path: string) => Promise<UpstreamReply | undefined> | undefined) | undefined;
  const config: ConnectorConfig = {
    publicUrl: origin,
    adminPassword: "synthetic-admin-password-for-the-rest-test",
    storageKey: Buffer.alloc(32, 1),
    stateDir: "/unused",
    port: 3000,
    school: "synthetic-fixture",
    proxyHops: options.proxyHops ?? 1,
  };
  let state: OAuthState | undefined;
  const oauth = new ConnectorOAuthProvider({
    resourceUrl: resource,
    scopes: ALL,
    now: () => clock,
    repository: {
      read: () => state,
      write: (value) => {
        state = value;
      },
    },
  });
  let identity: string | undefined;
  const runtime = new ConnectorRuntime({
    config: resolveConfig([{ school: config.school }], { home: "/unused", platform: "linux" }),
    store: new MemorySessionStore(),
    identityStore: {
      read: () => identity,
      write: (value) => {
        identity = value;
      },
    },
    redirectUri: origin + "/schoolsoft/callback",
    deps: {
      pending: new MemoryPendingLoginStore(),
      history: new MemorySessionHistoryStore(),
      // The real budget where a test asks for it; elsewhere nothing throttles the many reads here.
      budget: options.budget ?? new CountingBudget(),
      fetchImpl: async (
        url: string,
        school: string,
        request?: { method?: string; headers?: Record<string, string> },
      ) => {
        const path = new URL(url).pathname.replace(/^\/[^/]+/, "");
        const replaced = await intercept?.(path);
        return replaced ?? upstream.fetchImpl(url, school, request);
      },
    },
  });
  const app = createConnectorApp({ config, oauth, runtime, lang: options.lang, now: options.now });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await runtime.close();
    server.close();
    server.closeAllConnections();
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = (
    path: string,
    init: { method?: string; headers?: Record<string, string>; body?: string } = {},
  ): Promise<Reply> =>
    new Promise((resolve, reject) => {
      const req = httpRequest(
        base + path,
        { method: init.method ?? "GET", headers: { Host: "connector.example", ...init.headers } },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            const headers = new Headers();
            for (const [key, value] of Object.entries(res.headers))
              if (value !== undefined)
                headers.set(key, Array.isArray(value) ? value.join(", ") : value);
            const text = Buffer.concat(chunks).toString();
            resolve({ status: res.statusCode!, headers, text, json: () => JSON.parse(text) });
          });
        },
      );
      req.on("error", reject);
      req.end(init.body);
    });
  const form = (path: string, values: URLSearchParams, headers: Record<string, string> = {}) =>
    request(path, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: origin, ...headers },
      body: values.toString(),
    });

  // The connector signs in to the (fake) portal; the parent's BankID step is simulated.
  const { url } = await runtime.beginLogin();
  const upstreamState = decodeURIComponent(/[?&#]state=([^&#]+)/.exec(url)![1]);
  assert.equal(runtime.callback(upstreamState, FAKE_UPSTREAM_CODE), true);
  for (let attempt = 0; !(await runtime.status()).authenticated; attempt++) {
    assert.ok(attempt < 50, "the fake sign-in did not complete");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  const login = await form("/owner/login", new URLSearchParams({ password: config.adminPassword }));
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  const csrf = /name="csrf" value="([^"]+)"/.exec(
    (await request("/owner", { headers: { Cookie: cookie } })).text,
  )![1];

  /** An app connected through the ordinary consent flow; returns its access token. */
  async function connect(scopes: string[] = ALL, children: number[] = [ALVA]) {
    const registered = await request("/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Synthetic UI",
        redirect_uris: [callback],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      }),
    });
    const clientId = registered.json().client_id as string;
    const authorized = await request(
      "/authorize?" +
        new URLSearchParams({
          client_id: clientId,
          response_type: "code",
          redirect_uri: callback,
          resource,
          code_challenge: challenge,
          code_challenge_method: "S256",
          scope: scopes.join(" "),
        }),
    );
    const id = new URL(authorized.headers.get("location")!, origin).searchParams.get("request")!;
    const approved = await form(
      "/owner/approve",
      new URLSearchParams([
        ["csrf", csrf],
        ["request", id],
        ...children.map((child) => ["children", String(child)]),
        ...scopes.map((scope) => ["scopes", scope]),
      ]),
      { Cookie: cookie },
    );
    const code = new URL(approved.headers.get("location")!).searchParams.get("code")!;
    const tokens = (
      await form(
        "/token",
        new URLSearchParams({
          grant_type: "authorization_code",
          client_id: clientId,
          code,
          code_verifier: verifier,
          redirect_uri: callback,
          resource,
        }),
      )
    ).json();
    const grantId = oauth.listGrants().find((grant) => grant.clientId === clientId)!.id;
    return {
      access: tokens.access_token as string,
      refresh: tokens.refresh_token as string,
      grantId,
    };
  }
  const api = (path: string, token: string, headers: Record<string, string> = {}) =>
    request("/api/v1" + path, { headers: { Authorization: `Bearer ${token}`, ...headers } });
  return {
    config,
    oauth,
    runtime,
    upstream,
    request,
    connect,
    api,
    intercept: (fn: typeof intercept) => {
      intercept = fn;
    },
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

function assertProblem(reply: Reply, status: number, name: string) {
  assert.equal(reply.status, status, reply.text);
  assert.match(reply.headers.get("content-type")!, /^application\/problem\+json/);
  const body = reply.json();
  assert.equal(body.type, "urn:schoolsoft-agent:problem:" + name);
  assert.equal(body.status, status);
  return body;
}
const lessonReads = (calls: string[]) => calls.filter((c) => c.includes("/lessons/week/")).length;

test("each generated route returns its operation's validated domain shape, as /mcp would", async (t) => {
  const f = await fixture(t);
  const { access } = await f.connect(ALL, [ALVA, BO]);
  const children = await f.api("/children", access);
  assert.equal(children.status, 200);
  assert.match(children.headers.get("content-type")!, /^application\/json/);
  assert.deepEqual(children.json(), {
    children: FAKE_GUARDIAN.children.map((c) => ({ id: c.studentId, firstName: c.firstName })),
    childInFocus: ALVA,
  });

  const schedule = await f.api(`/children/${BO}/schedule?week=37`, access);
  assert.equal(schedule.status, 200);
  const lessons = schedule.json();
  assert.deepEqual(getOperation("get_schedule")!.output!.parse(lessons), lessons);
  assert.deepEqual(lessons.child, { id: BO, firstName: "Synthetic Bo" });
  assert.equal(lessons.week, 37);
  assert.equal(
    (lessons.lessons as { note: string }[])[0].note,
    `servedForChild=${BO}`,
    "the child comes from the path, not from the focus the login left",
  );
  // The read cache and `fresh` apply exactly as through runOperation (a child switch
  // empties the cache, so this runs before the other child is read).
  const before = lessonReads(f.upstream.calls);
  assert.equal((await f.api(`/children/${BO}/schedule?week=37`, access)).status, 200);
  assert.equal(lessonReads(f.upstream.calls), before, "served from the read cache");
  assert.equal((await f.api(`/children/${BO}/schedule?week=37&fresh=true`, access)).status, 200);
  assert.equal(lessonReads(f.upstream.calls), before + 1, "fresh=true reads upstream");
  // The response carries the connector's headers unchanged.
  assert.equal(schedule.headers.get("content-security-policy"), CSP);
  assert.equal(schedule.headers.get("cache-control"), "no-store");
  assert.equal(schedule.headers.get("x-content-type-options"), "nosniff");
  assert.equal(schedule.headers.get("access-control-allow-origin"), null);

  const calendar = await f.api(
    `/children/${ALVA}/calendar?start_date=2026-09-07&end_date=2026-09-13`,
    access,
  );
  assert.equal(calendar.status, 200);
  const events = calendar.json();
  assert.deepEqual(getOperation("get_calendar")!.output!.parse(events), events);
  assert.match(calendar.text, /Synthetic school event/);

  const lunch = await f.api(`/children/${ALVA}/lunch-menu?week=37`, access);
  assert.equal(lunch.status, 200);
  const menu = lunch.json();
  assert.deepEqual(getOperation("get_lunch_menu")!.output!.parse(menu), menu);
  assert.equal(
    (menu.days as { dishes: { description: string }[] }[])[0].dishes[0].description,
    FAKE_LUNCH_DISH,
  );
});

test("query and path validation answers 400 problem+json before any upstream read", async (t) => {
  const f = await fixture(t);
  const { access } = await f.connect();
  const calls = f.upstream.calls.length;
  for (const path of [
    `/children/${ALVA}/schedule?week=abc`,
    `/children/${ALVA}/schedule?other=1`,
    `/children/${ALVA}/schedule?week=1&week=2`,
    `/children/${ALVA}/schedule?week=99`,
    `/children/${ALVA}/schedule?child_id=${BO}`,
    `/children/${ALVA}/schedule?fresh=1`,
    "/children/abc/schedule",
    "/children/0/schedule",
    "/children?week=1",
  ]) {
    const body = assertProblem(await f.api(path, access), 400, "invalid-input");
    assert.equal(body.kind, "input");
    assert.equal(body.hint, "Check the path and query parameters against the REST reference.");
  }
  assert.equal(f.upstream.calls.length, calls);
  const range = await f.api(`/children/${ALVA}/calendar?start_date=2026-09-07`, access, {
    "Accept-Language": "sv-SE,sv;q=0.9",
  });
  const body = assertProblem(range, 400, "invalid-input");
  assert.match(String(body.detail), /Ange både start_date och end_date/);
  assert.equal(range.headers.get("content-language"), "sv");
  assert.equal(range.headers.get("vary"), "Accept-Language");
  assert.ok(!f.upstream.calls.slice(calls).some((c) => c.includes("/agenda")));
});

test("missing, invalid or expired tokens get the SDK's 401; a grant revoked mid-request releases nothing", async (t) => {
  const f = await fixture(t);
  const { access, grantId } = await f.connect();
  const anonymous = await f.request(`/api/v1/children/${ALVA}/schedule`);
  assert.equal(anonymous.status, 401);
  assert.match(
    anonymous.headers.get("www-authenticate")!,
    /^Bearer .*resource_metadata="https:\/\/connector\.example\/\.well-known\/oauth-protected-resource\/mcp"/,
  );
  const wrong = await f.api(`/children/${ALVA}/schedule`, "wrong-token");
  assert.equal(wrong.status, 401);
  assert.match(wrong.headers.get("www-authenticate")!, /error="invalid_token"/);

  f.intercept((path) => {
    if (path.includes("/lessons/week/")) f.oauth.revokeGrant(grantId);
    return undefined;
  });
  const revoked = await f.api(`/children/${ALVA}/schedule?week=37`, access);
  const body = assertProblem(revoked, 401, "oauth-token");
  assert.equal(body.error, "invalid_token");
  assert.match(revoked.headers.get("www-authenticate")!, /^Bearer error="invalid_token"/);
  assert.doesNotMatch(revoked.text, /Synthetic lesson|servedForChild/);
  assert.equal((await f.api("/children", access)).status, 401, "the token died with its grant");

  f.intercept(undefined);
  const later = await f.connect();
  assert.equal((await f.api("/children", later.access)).status, 200);
  f.advance(6 * 60_000);
  const expired = await f.api("/children", later.access);
  assert.equal(expired.status, 401);
  assert.match(expired.headers.get("www-authenticate")!, /resource_metadata=/);
});

test("a missing scope or an unapproved child is refused before any upstream call", async (t) => {
  const f = await fixture(t);
  const { access } = await f.connect(["list_children", "get_schedule"], [ALVA]);
  const calls = f.upstream.calls.length;
  const calendar = await f.api(`/children/${ALVA}/calendar`, access);
  const scope = assertProblem(calendar, 403, "scope-not-granted");
  assert.equal(scope.error, "insufficient_scope");
  assert.match(String(scope.detail), /not approved for get_calendar/);
  assert.equal(
    calendar.headers.get("www-authenticate"),
    `Bearer error="insufficient_scope", scope="get_calendar", resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
  );
  assertProblem(await f.api(`/children/${ALVA}/lunch-menu`, access), 403, "scope-not-granted");
  for (const child of [BO, 999]) {
    const refused = await f.api(`/children/${child}/schedule?week=37`, access);
    const body = assertProblem(refused, 403, "child-not-permitted");
    assert.match(String(body.hint), /connect this app again/);
    assert.doesNotMatch(refused.text, /Synthetic Bo/);
  }
  assert.deepEqual(f.upstream.calls.slice(calls), [], "no upstream request at all");
  assert.deepEqual((await f.api("/children", access)).json().children, [
    { id: ALVA, firstName: "Synthetic Alva" },
  ]);
});

test("parallel requests for two children never return one child's data for the other", async (t) => {
  const f = await fixture(t);
  const { access } = await f.connect(ALL, [ALVA, BO]);
  const requests = Array.from({ length: 12 }, (_, i) => {
    const child = i % 2 ? BO : ALVA;
    const path =
      i % 3 === 2
        ? `/children/${child}/lunch-menu?week=${30 + i}`
        : `/children/${child}/schedule?week=${30 + i}&fresh=true`;
    return f.api(path, access).then((reply) => ({ child, path, reply }));
  });
  for (const { child, path, reply } of await Promise.all(requests)) {
    assert.equal(reply.status, 200, path);
    const body = reply.json() as { child: { id: number }; lessons?: { note: string }[] };
    assert.equal(body.child.id, child, path);
    if (body.lessons) assert.equal(body.lessons[0].note, `servedForChild=${child}`, path);
  }
});

test("portal drift is a 502 with the drift message in Swedish and English; nothing is cached", async (t) => {
  const f = await fixture(t);
  const { access } = await f.connect();
  f.intercept(async (path) =>
    path.includes("/lessons/week/")
      ? { status: 200, data: [{ eventId: 1, title: "renamed" }], headers: {}, setCookies: [] }
      : undefined,
  );
  const sv = await f.api(`/children/${ALVA}/schedule?week=37`, access, {
    "Accept-Language": "sv",
  });
  const svBody = assertProblem(sv, 502, "response-drift");
  assert.match(String(svBody.detail), /Skolportalens svar för get_schedule har ändrat form/);
  assert.match(String(svBody.hint), /^Att försöka igen hjälper inte/);
  assert.equal(svBody.retryable, false);
  assert.equal(svBody.kind, "upstream");
  const en = await f.api(`/children/${ALVA}/schedule?week=37`, access, {
    "Accept-Language": "en-GB,en;q=0.9",
  });
  const enBody = assertProblem(en, 502, "response-drift");
  assert.match(String(enBody.detail), /answer for get_schedule has changed shape/);
  assert.doesNotMatch(en.text, /renamed/);
  f.intercept(undefined);
  const before = lessonReads(f.upstream.calls);
  assert.equal((await f.api(`/children/${ALVA}/schedule?week=37`, access)).status, 200);
  assert.equal(lessonReads(f.upstream.calls), before + 1, "the drifted answer was not cached");
});

test("a lost SchoolSoft session is 409 with the owner dashboard, distinct from a bad token", async (t) => {
  const f = await fixture(t, { lang: "sv" });
  const { access } = await f.connect();
  // The portal rejects the session and the silent re-login alike.
  f.intercept(async (path) =>
    path.includes("/lessons/week/") || path.includes("/login/token")
      ? { status: 401, data: null, headers: {}, setCookies: [] }
      : undefined,
  );
  const rejected = await f.api(`/children/${ALVA}/schedule?week=37`, access);
  const body = assertProblem(rejected, 409, "schoolsoft-session");
  assert.equal(body.ownerDashboard, origin + "/owner");
  assert.equal(rejected.headers.get("www-authenticate"), null, "the token is not the problem");
  assert.equal(rejected.headers.get("content-language"), "sv", "the connector's default");
  assert.match(String(body.hint), /ägarsida och logga in på SchoolSoft igen med BankID/);
  f.intercept(undefined);
  const signedOut = await f.api(`/children/${ALVA}/schedule`, access, {
    "Accept-Language": "en",
  });
  const again = assertProblem(signedOut, 409, "schoolsoft-session");
  assert.match(String(again.detail), /^Not logged in to SchoolSoft/);
  assert.match(String(again.hint), /owner dashboard and sign in to SchoolSoft again/);
  assert.equal((await f.api("/session", access)).json().ownerDashboard, origin + "/owner");
});

test("GET /api/v1/session tells a UI what it may show, signed in or out, without secrets", async (t) => {
  const f = await fixture(t);
  const { access, refresh, grantId } = await f.connect(["list_children", "get_schedule"], [ALVA]);
  const signedIn = await f.api("/session", access);
  assert.equal(signedIn.status, 200);
  const body = signedIn.json();
  const expires = f.oauth.listGrants()[0].expiresAt;
  assert.deepEqual(body, {
    schoolsoft: {
      signedIn: true,
      loginInProgress: false,
      webSession: false,
      portal: { state: "ok", retryAt: null },
    },
    children: [{ id: ALVA, firstName: "Synthetic Alva" }],
    scopes: ["list_children", "get_schedule"],
    routes: [
      { operation: "list_children", method: "GET", path: "/api/v1/children" },
      { operation: "get_schedule", method: "GET", path: "/api/v1/children/{childId}/schedule" },
    ],
    ownerDashboard: origin + "/owner",
    connectionExpiresAt: new Date(expires).toISOString(),
  });
  for (const secret of [
    access,
    refresh,
    grantId,
    ...FAKE_UPSTREAM_SECRETS,
    "JSESSIONID",
    "child-" + ALVA,
    String(FAKE_GUARDIAN.userId),
    f.config.adminPassword,
    "Synthetic Bo",
    "Guardian",
  ])
    assert.ok(!signedIn.text.includes(secret), `the session body leaks ${secret}`);

  await f.runtime.logout();
  const calls = f.upstream.calls.length;
  const signedOut = await f.api("/session", access);
  assert.equal(signedOut.status, 200);
  assert.deepEqual(signedOut.json().schoolsoft, {
    signedIn: false,
    loginInProgress: false,
    webSession: false,
    portal: { state: "ok", retryAt: null },
  });
  assert.deepEqual(signedOut.json().children, []);
  assert.deepEqual(f.upstream.calls.slice(calls), [], "no login and no upstream request");
});

test("a grant revoked while /session waited in the queue is refused", async (t) => {
  const f = await fixture(t);
  const { access, grantId } = await f.connect(ALL, [ALVA]);
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  let reading!: () => void;
  const started = new Promise<void>((resolve) => (reading = resolve));
  f.intercept(async (path) => {
    if (path.includes("/lessons/week/")) {
      reading();
      await held;
    }
    return undefined;
  });
  const read = f.api(`/children/${ALVA}/schedule?week=37&fresh=true`, access);
  await started;
  // Revoke only once /session has asked the runtime, i.e. waits behind the held read.
  let asked!: () => void;
  const waiting = new Promise<void>((resolve) => (asked = resolve));
  const status = f.runtime.status.bind(f.runtime);
  t.mock.method(f.runtime, "status", () => {
    asked();
    return status();
  });
  const session = f.api("/session", access);
  await waiting;
  f.oauth.revokeGrant(grantId);
  release();
  assertProblem(await read, 401, "oauth-token");
  const refused = await session;
  assertProblem(refused, 401, "oauth-token");
  assert.doesNotMatch(refused.text, /Synthetic Alva/);
});

test("a full runtime queue answers 503 with Retry-After", async (t) => {
  const f = await fixture(t);
  const { access } = await f.connect(ALL, [ALVA]);
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  f.intercept(async (path) => {
    if (path.includes("/lessons/week/")) await held;
    return undefined;
  });
  const queued = Array.from({ length: 16 }, (_, i) =>
    f.api(`/children/${ALVA}/schedule?week=${i + 1}&fresh=true`, access),
  );
  // Probe until the runtime is full: a probe that does not answer at once is queued too.
  let busy: Reply | undefined;
  for (let attempt = 0; !busy; attempt++) {
    assert.ok(attempt < 200, "the queue never filled");
    const probe = f.api(`/children/${ALVA}/schedule?week=20`, access);
    const first = await Promise.race([
      probe,
      new Promise<undefined>((resolve) => setTimeout(resolve, 25)),
    ]);
    if (first) busy = first;
    else queued.push(probe);
  }
  const body = assertProblem(busy, 503, "connector-busy");
  assert.equal(busy.headers.get("retry-after"), "1");
  assert.equal(body.retryable, true);
  release();
  for (const reply of await Promise.all(queued)) assert.equal(reply.status, 200);
});

test("owner pages keep their CSP; foreign origins, unknown routes and other methods are refused", async (t) => {
  const f = await fixture(t);
  const { access } = await f.connect();
  const owner = await f.request("/owner/login");
  assert.equal(owner.headers.get("content-security-policy"), CSP);
  assert.equal(owner.headers.get("strict-transport-security"), "max-age=31536000");
  assert.equal(owner.headers.get("referrer-policy"), "no-referrer");
  const foreign = await f.api("/children", access, { Origin: "https://evil.example" });
  assertProblem(foreign, 403, "foreign-origin");
  assert.equal((await f.api("/children", access, { Origin: origin })).status, 200);
  assertProblem(await f.api("/nothing-here", access), 404, "not-found");
  const post = await f.request("/api/v1/children", {
    method: "POST",
    headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
    body: "{}",
  });
  assertProblem(post, 404, "not-found");
});

test("the REST limit is per caller, answers 429 problem+json and counts bad tokens too", async (t) => {
  const f = await fixture(t, { proxyHops: 0 });
  for (let i = 0; i < REST_REQUESTS_PER_MINUTE; i++)
    assert.equal((await f.request("/api/v1/session")).status, 401);
  const limited = await f.request("/api/v1/session");
  assertProblem(limited, 429, "rate-limited");
  assert.ok(Number(limited.headers.get("retry-after")) > 0);
  assert.match(limited.headers.get("ratelimit-policy")!, /60/);
});

test("the school portal pushing back is 503 portal-pushback with Retry-After, in Swedish and English; /session says until when", async (t) => {
  const clock = new FakeClock(Date.now());
  const budget = createRequestBudget(
    { provider: "schoolsoft", requestBudget: {} },
    { now: clock.now, timer: clock },
  );
  const f = await fixture(t, { budget, now: clock.now });
  const { access } = await f.connect();
  let sent = 0;
  let answer = { status: 429, data: null, headers: { "retry-after": "60" }, setCookies: [] };
  f.intercept(async (path) => {
    if (!path.includes("/lessons/week/")) return undefined;
    sent++;
    return answer;
  });
  const slowed = await f.api(`/children/${ALVA}/schedule?week=37`, access, {
    "Accept-Language": "sv",
  });
  const body = assertProblem(slowed, 503, "portal-pushback");
  assert.equal(slowed.headers.get("retry-after"), "60");
  assert.equal(body.retryAt, new Date(clock.now() + 60_000).toISOString());
  assert.equal(body.kind, "upstream");
  assert.equal(body.retryable, true);
  assert.match(String(body.detail), /SchoolSoft ber om färre förfrågningar.*ungefär 1 minut\./);
  assert.match(String(body.hint), /försök igen efter Retry-After/);
  assert.equal(sent, 1);

  clock.t += 30_000;
  const refused = await f.api(`/children/${ALVA}/schedule?week=37`, access, {
    "Accept-Language": "en",
  });
  const refusedBody = assertProblem(refused, 503, "portal-pushback");
  assert.equal(refused.headers.get("retry-after"), "30");
  assert.match(String(refusedBody.detail), /pausing requests to it for 30 seconds/);
  assert.match(String(refusedBody.hint), /Signing in again does not help/);
  assert.equal(sent, 1, "refused by the budget: nothing was sent");
  const about = (await f.api("/session", access)).json() as {
    schoolsoft: { signedIn: boolean; portal: unknown };
  };
  assert.equal(about.schoolsoft.signedIn, true, "the session is kept");
  assert.deepEqual(about.schoolsoft.portal, {
    state: "backing_off",
    retryAt: new Date(clock.now() + 30_000).toISOString(),
  });

  // Two more push-backs within two minutes, each after its pause: the breaker opens for five minutes.
  answer = { status: 503, data: null, headers: { "retry-after": "1" }, setCookies: [] };
  await clock.advance(30_000);
  assertProblem(await f.api(`/children/${ALVA}/schedule?week=37`, access), 502, "upstream");
  await clock.advance(1_000);
  assertProblem(await f.api(`/children/${ALVA}/schedule?week=37`, access), 502, "upstream");
  assert.equal(sent, 3);
  const paused = await f.api(`/children/${ALVA}/schedule?week=37`, access);
  const pausedBody = assertProblem(paused, 503, "portal-pushback");
  assert.equal(paused.headers.get("retry-after"), "300");
  assert.match(String(pausedBody.detail), /pushed back several times in a row.*Nothing was sent/);
  assert.equal(sent, 3);
  assert.equal(
    ((await f.api("/session", access)).json() as { schoolsoft: { portal: { state: string } } })
      .schoolsoft.portal.state,
    "paused",
  );
  // After the cool-down one request tests the water, gets an answer, and everything flows again.
  f.intercept(undefined);
  await clock.advance(300_000);
  assert.equal((await f.api(`/children/${ALVA}/schedule?week=37`, access)).status, 200);
  assert.equal(
    ((await f.api("/session", access)).json() as { schoolsoft: { portal: { state: string } } })
      .schoolsoft.portal.state,
    "ok",
  );
});
