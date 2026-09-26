/**
 * The SchoolSoft side of session longevity: renewing tokens without user
 * interaction, reporting every rotation at once, and the keepalive touch of
 * the web session (one GET, never a write). Offline stand-in, no network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { BankIdBrowserStrategy } from "../../src/providers/schoolsoft/auth/bankid-browser.js";
import { SchoolsoftSession } from "../../src/providers/schoolsoft/session.js";
import { FakeClock, noRequests } from "../helpers/budget.js";
import { ApiPortal } from "../../src/providers/schoolsoft/portal/api-portal.js";
import {
  MemorySessionHistoryStore,
  MemorySessionStore,
  SessionLostError,
  UpstreamError,
  WebLoginRequiredError,
  createSessionManager,
  createRequestBudget,
  resolveConfig,
} from "../../src/core/index.js";
import { SchoolsoftSim, jwt, savedSession } from "../helpers/schoolsoft-sim.js";

const T0 = 1_900_000_000_000;
const LEAD = 3 * 60_000;

function strategy(sim: SchoolsoftSim) {
  const rotations: string[] = [];
  const session = new SchoolsoftSession("taby", noRequests);
  const s = new BankIdBrowserStrategy({
    fetchImpl: sim.fetch,
    onRefresh: () => rotations.push(String(session.client.refreshToken)),
  });
  return { s, session, rotations };
}

test("renew: refreshes inside the lead time, adopts the rotated pair and reports the new expiry", async () => {
  const sim = new SchoolsoftSim(() => T0);
  const { s, session, rotations } = strategy(sim);
  const r = await s.renew(session, savedSession(T0, 120), { now: T0, leadMs: LEAD });
  assert.equal(r.expiresAt, (Math.floor(T0 / 1000) + 900) * 1000);
  assert.deepEqual(
    rotations,
    ["refresh-1"],
    "reported once, with the new token already on the session",
  );
  assert.deepEqual(sim.requests, [
    "POST /taby/rest-api/login/token?clientId=vApp&grantType=refresh_token&refreshToken=refresh-0",
  ]);
});

test("renew: a token that outlives the lead time is adopted as it is (another process refreshed it)", async () => {
  const sim = new SchoolsoftSim(() => T0);
  const { s, session, rotations } = strategy(sim);
  const saved = savedSession(T0, 900);
  const r = await s.renew(session, saved, { now: T0, leadMs: LEAD });
  assert.equal(r.expiresAt, (Math.floor(T0 / 1000) + 900) * 1000);
  assert.equal(session.client.accessToken, saved.data.accessToken);
  assert.deepEqual([sim.requests, rotations], [[], []]);
});

test("renew: unknown expiry refreshes; an opaque new token has no known expiry; guards fail before any request", async () => {
  const sim = new SchoolsoftSim(() => T0);
  const { s, session } = strategy(sim);
  const unknown = { ...savedSession(T0), data: { accessToken: "old", refreshToken: "refresh-0" } };
  assert.notEqual((await s.renew(session, unknown, { now: T0, leadMs: LEAD })).expiresAt, null);
  assert.equal(sim.refreshes, 1);

  const opaque = new BankIdBrowserStrategy({
    fetchImpl: async () => ({
      status: 200,
      data: { access_token: "opaque" },
      headers: {},
      setCookies: [],
    }),
  });
  assert.deepEqual(
    await opaque.renew(new SchoolsoftSession("taby", noRequests), savedSession(T0, 1), {
      now: T0,
      leadMs: LEAD,
    }),
    { expiresAt: null },
  );

  const before = sim.requests.length;
  await assert.rejects(
    s.renew(
      new SchoolsoftSession("taby", noRequests),
      { ...savedSession(T0), data: {} },
      { now: T0, leadMs: LEAD },
    ),
    /no access token/,
  );
  await assert.rejects(
    s.renew(
      new SchoolsoftSession("taby", noRequests),
      { ...savedSession(T0), data: { accessToken: jwt(1) } },
      { now: T0, leadMs: LEAD },
    ),
    /no refresh token saved/,
  );
  assert.equal(sim.requests.length, before);
});

test("renew: a rejected refresh is a login problem; a failing server is retryable and keeps the session", async () => {
  const sim = new SchoolsoftSim(() => T0);
  const { s, session, rotations } = strategy(sim);
  sim.refreshStatus = 400;
  await assert.rejects(s.renew(session, savedSession(T0, 1), { now: T0, leadMs: LEAD }), /nej/);
  sim.refreshStatus = 503;
  await assert.rejects(
    s.renew(session, savedSession(T0, 1), { now: T0, leadMs: LEAD }),
    (e: unknown) => e instanceof UpstreamError && e.retryable,
  );
  assert.deepEqual(rotations, []);
});

test("wiring: a refresh followed by a failing profile lookup leaves the ROTATED token on disk, and the session in place", async () => {
  const sim = new SchoolsoftSim(() => T0);
  const store = new MemorySessionStore();
  const history = new MemorySessionHistoryStore();
  store.save({
    ...savedSession(T0),
    data: { accessToken: jwt(1), refreshToken: "refresh-0", accessTokenExpiresAt: 1 },
  });
  const config = resolveConfig([{ school: "taby", configDir: "/nowhere" }], {
    home: "/unused",
    platform: "linux",
  });
  const clock = new FakeClock(T0);
  const manager = createSessionManager(config, {
    store,
    history,
    now: () => T0,
    budget: createRequestBudget(config, { now: clock.now, timer: clock }),
    fetchImpl: sim.fetch,
  });
  sim.parentStatus = 503;
  await assert.rejects(manager.ensureSession(), /HTTP 503/);
  assert.equal(
    (store.load()!.data as { refreshToken: string }).refreshToken,
    "refresh-1",
    "refresh-0 is spent upstream; losing refresh-1 here would force a BankID login",
  );
  assert.equal(history.read()!.app!.activityCount, 1);
  sim.parentStatus = 200;
  // next call: no login, the rotated token works (after the budget's 2 s pause for the 503)
  const next = manager.ensureSession();
  await clock.advance(2_000);
  await next;
  assert.deepEqual(
    sim.requests.slice(-3).map((r) => r.replace(/\?.*/, "")),
    [
      "GET /taby/eva/api/v1/parent",
      "GET /taby/eva-apps/auth/login/parent",
      "GET /taby/rest-api/session",
    ],
  );
  assert.equal(manager.guardian().userId, 21);
});

function api(sim: SchoolsoftSim, webCookie: string | null) {
  return new ApiPortal({
    school: "taby",
    accessToken: () => "token",
    cookieHeader: () => "JSESSIONID=app",
    webCookieHeader: () => webCookie,
    webChildTarget: () => ({ childId: 101, orgId: 20 }), // a different child than the header reports
    fetchImpl: sim.fetch,
  });
}

test("web touch: one GET of the portal's header with the web cookies; never a PUT, even when the child differs", async () => {
  const sim = new SchoolsoftSim(() => T0);
  await api(sim, "JSESSIONID=web").touchWebSession();
  assert.deepEqual(sim.requests, ["GET /taby/rest-api/parent/header/parent"]);
});

test("web touch: 401/403 or an answer that is not the header mean the web session is gone; other failures pass through", async () => {
  const sim = new SchoolsoftSim(() => T0);
  const portal = api(sim, "JSESSIONID=web");
  for (const dead of [
    { status: 401, data: null },
    { status: 403, data: null },
    { status: 200, data: "<html>login</html>" },
    { status: 200, data: null },
    { status: 200, data: { currentChildId: "100" } },
  ]) {
    sim.webHeader = dead;
    await assert.rejects(
      portal.touchWebSession(),
      (e: unknown) => e instanceof SessionLostError && e.web && e.key === "web_session_lost",
      JSON.stringify(dead),
    );
  }
  sim.webHeader = { status: 500, data: null };
  await assert.rejects(
    portal.touchWebSession(),
    (e: unknown) => e instanceof UpstreamError && e.retryable,
  );
  const before = sim.requests.length;
  await assert.rejects(api(sim, null).touchWebSession(), WebLoginRequiredError);
  assert.equal(sim.requests.length, before, "no web login, no request");
});
