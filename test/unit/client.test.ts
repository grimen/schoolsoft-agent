/** The typed client against a scripted fetch: refresh single-flight, validation, errors. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ConnectorError,
  EXPIRY_MARGIN_MS,
  ROUTES,
  SCHEMAS,
  createClient,
  memoryTokenStore,
  validate,
  type Tokens,
} from "../../src/client/index.js";

const unexpected = (): never => assert.fail("expected a ConnectorError");
const BASE = "https://connector.example";
const SCHEDULE = {
  year: 2026,
  week: 39,
  startDate: "2026-09-21",
  endDate: "2026-09-27",
  child: { id: 7, firstName: "Alva" },
  lessons: [
    {
      id: "lesson:1@2026-09-21T08:00:00+02:00",
      title: "Math",
      start: "2026-09-21T08:00:00+02:00",
      end: "2026-09-21T09:00:00+02:00",
      room: null,
      group: null,
      teacher: null,
      note: null,
    },
  ],
};
const PROBLEM = (name: string, status: number, extra: Record<string, unknown> = {}) => ({
  type: "urn:schoolsoft-agent:problem:" + name,
  title: name,
  status,
  detail: `detail of ${name}`,
  hint: `hint for ${name}`,
  kind: "upstream",
  retryable: true,
  ...extra,
});

interface Seen {
  url: string;
  method: string;
  auth?: string;
  body?: string;
  headers: Record<string, string>;
}
type Handler = (seen: Seen) => Response | Promise<Response>;

const json = (body: unknown, status = 200, type = "application/json") =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": type } });
const problem = (body: ReturnType<typeof PROBLEM>) =>
  json(body, body.status, "application/problem+json");

/** A connector that accepts exactly the current access token and rotates on refresh. */
function connector(start: Tokens = { accessToken: "A1", refreshToken: "R1" }) {
  const seen: Seen[] = [];
  let valid = start.accessToken;
  let refresh = start.refreshToken;
  let generation = 1;
  let onRefresh: (() => Promise<void>) | undefined;
  /** 401s held back until this many have arrived, so they meet the client at once. */
  let together = 0;
  let waiting: (() => void)[] = [];
  /** A gate the next 401 waits behind (then it is used up). */
  let late: Promise<void> | undefined;
  let api: Handler = () => json(SCHEDULE);
  const fetch = async (input: string | URL | Request, init: RequestInit = {}) => {
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const entry: Seen = {
      url: String(input),
      method: init.method ?? "GET",
      auth: headers.authorization,
      body: init.body === undefined ? undefined : String(init.body),
      headers,
    };
    seen.push(entry);
    if (entry.url === BASE + "/token") {
      await onRefresh?.();
      const form = new URLSearchParams(entry.body);
      if (form.get("refresh_token") !== refresh)
        return json({ error: "invalid_grant", error_description: "Refresh token reused" }, 400);
      generation++;
      valid = "A" + generation;
      refresh = "R" + generation;
      return json({ access_token: valid, refresh_token: refresh, expires_in: 300 });
    }
    if (entry.auth !== `Bearer ${valid}`) {
      if (late) {
        const gate = late;
        late = undefined;
        await gate;
      }
      if (together > 1) {
        const arrived = new Promise<void>((resolve) => waiting.push(resolve));
        if (waiting.length >= together) {
          for (const release of waiting) release();
          waiting = [];
          together = 0;
        }
        await arrived;
      }
      return json({ error: "invalid_token", error_description: "Invalid access token" }, 401);
    }
    return api(entry);
  };
  return {
    seen,
    fetch,
    refreshes: () => seen.filter((s) => s.url.endsWith("/token")).length,
    expire: () => {
      valid = "none";
    },
    revoke: () => {
      valid = "none";
      refresh = "none";
    },
    answer: (handler: Handler) => {
      api = handler;
    },
    holdRefresh: (hold: () => Promise<void>) => {
      onRefresh = hold;
    },
    unauthorizedTogether: (count: number) => {
      together = count;
    },
    delayNextUnauthorized: (gate: Promise<void>) => {
      late = gate;
    },
  };
}

test("five calls meeting an expired token send exactly one refresh and retry once each", async () => {
  const c = connector();
  const store = memoryTokenStore({ accessToken: "A1", refreshToken: "R1" });
  const client = createClient({
    baseUrl: BASE + "/",
    clientId: "app",
    tokens: store,
    fetch: c.fetch,
  });
  c.expire();
  c.unauthorizedTogether(5);
  const calls = Array.from({ length: 5 }, (_, i) => client.schedule(7, { week: 30 + i }));
  const results = await Promise.all(calls);
  assert.equal(results.length, 5);
  assert.equal(c.seen.filter((s) => s.auth === "Bearer A1").length, 5, "five 401s at once");
  assert.equal(c.refreshes(), 1, "one refresh for all five");
  const retried = c.seen.filter((s) => s.auth === "Bearer A2");
  assert.equal(retried.length, 5, "each call retried once with the new token");
  assert.deepEqual(store.current(), {
    accessToken: "A2",
    refreshToken: "R2",
    expiresAt: store.current()!.expiresAt,
  });
  const refresh = new URLSearchParams(c.seen.find((s) => s.url.endsWith("/token"))!.body);
  assert.deepEqual(Object.fromEntries(refresh), {
    grant_type: "refresh_token",
    refresh_token: "R1",
    client_id: "app",
    resource: BASE + "/mcp",
  });
  // A call that met the old token after the rotation just uses the new one.
  assert.deepEqual(await client.schedule(7), SCHEDULE);
  assert.equal(c.refreshes(), 1);
});

test("a 401 for a token another call already rotated retries without refreshing", async () => {
  const c = connector();
  const client = createClient({
    baseUrl: BASE,
    clientId: "app",
    tokens: memoryTokenStore({ accessToken: "A1", refreshToken: "R1" }),
    fetch: c.fetch,
  });
  c.expire();
  let release!: () => void;
  c.delayNextUnauthorized(new Promise<void>((resolve) => (release = resolve)));
  // The first call's 401 arrives only after the second call has met its own and rotated.
  const slow = client.schedule(7, { week: 1 });
  while (c.seen.length < 1) await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(await client.schedule(7, { week: 2 }), SCHEDULE);
  assert.equal(c.refreshes(), 1);
  release();
  assert.deepEqual(await slow, SCHEDULE);
  assert.equal(c.seen.filter((s) => s.auth === "Bearer A2").length, 2);
  assert.equal(c.refreshes(), 1, "no second refresh");
});

test("a refused refresh clears the tokens and fails every waiting call once", async () => {
  const c = connector();
  const store = memoryTokenStore({ accessToken: "A1", refreshToken: "R1" });
  const client = createClient({ baseUrl: BASE, clientId: "app", tokens: store, fetch: c.fetch });
  c.revoke();
  const results = await Promise.allSettled([
    client.session(),
    client.children(),
    client.schedule(7),
  ]);
  assert.equal(c.refreshes(), 1);
  for (const result of results) {
    assert.equal(result.status, "rejected");
    const error = (result as PromiseRejectedResult).reason as ConnectorError;
    assert.ok(error instanceof ConnectorError);
    assert.equal(error.kind, "not_authenticated");
    assert.equal(error.problem, "oauth-token");
    assert.equal(error.retryable, false);
    assert.equal(error.status, 400);
  }
  assert.equal(store.current(), undefined);
  const again = await client.schedule(7).then(unexpected, (e: unknown) => e as ConnectorError);
  assert.equal(again.problem, "oauth-token");
  assert.equal(again.status, null, "nothing sent without tokens");
  assert.equal(c.refreshes(), 1);
});

test("a 401 that survives the refresh disconnects; a known expiry refreshes before sending", async () => {
  const c = connector();
  let now = 1_000_000;
  const store = memoryTokenStore({
    accessToken: "A1",
    refreshToken: "R1",
    expiresAt: now + 60_000,
  });
  const client = createClient({
    baseUrl: BASE,
    clientId: "app",
    tokens: store,
    fetch: c.fetch,
    now: () => now,
  });
  assert.equal(await client.accessToken(), "A1");
  now += 60_000 - EXPIRY_MARGIN_MS;
  assert.deepEqual(await client.schedule(7), SCHEDULE);
  assert.equal(c.refreshes(), 1);
  assert.ok(
    !c.seen.some((s) => s.auth === "Bearer A1" && !s.url.endsWith("/token")),
    "no 401 trip",
  );
  assert.equal(store.current()!.expiresAt, now + 300_000);

  // The grant is revoked between the refresh and the retry: the retry's 401 ends it.
  c.answer(() =>
    problem(PROBLEM("oauth-token", 401, { kind: "not_authenticated", retryable: false })),
  );
  const gone = await client.schedule(7).then(unexpected, (e: unknown) => e as ConnectorError);
  assert.equal(gone.problem, "oauth-token");
  assert.equal(gone.status, 401);
  assert.equal((gone.cause as ConnectorError).problem, "oauth-token");
  assert.equal(store.current(), undefined);
});

test("problem details, network failures, foreign answers and drift map to the existing kinds", async () => {
  const c = connector();
  const client = createClient({
    baseUrl: BASE,
    clientId: "app",
    tokens: memoryTokenStore({ accessToken: "A1", refreshToken: "R1" }),
    fetch: c.fetch,
    language: "sv",
  });
  const failure = (call: Promise<unknown>) =>
    call.then(unexpected, (e: unknown) => e as ConnectorError);

  c.answer(() =>
    problem(
      PROBLEM("schoolsoft-session", 409, {
        kind: "not_authenticated",
        retryable: false,
        ownerDashboard: BASE + "/owner",
      }),
    ),
  );
  const session = await failure(client.overview(7, { date: "2026-09-26" }));
  assert.deepEqual(
    [session.kind, session.problem, session.status, session.retryable, session.ownerDashboard],
    ["not_authenticated", "schoolsoft-session", 409, false, BASE + "/owner"],
  );
  assert.equal(session.message, "detail of schoolsoft-session");
  assert.equal(session.hint, "hint for schoolsoft-session");
  assert.equal(session.body!.type, "urn:schoolsoft-agent:problem:schoolsoft-session");
  const last = c.seen.at(-1)!;
  assert.equal(last.url, BASE + "/api/v1/children/7/overview?date=2026-09-26");
  assert.equal(last.headers["accept-language"], "sv");
  assert.equal(c.refreshes(), 0, "a 409 is not the token");

  c.answer(() => problem(PROBLEM("portal-pushback", 503, { retryAt: "2026-09-26T12:00:00.000Z" })));
  const pushback = await failure(
    client.calendar(7, { start_date: "2026-09-21", end_date: undefined }),
  );
  assert.equal(pushback.retryAt, "2026-09-26T12:00:00.000Z");
  assert.equal(pushback.retryable, true);
  assert.equal(c.seen.at(-1)!.url, BASE + "/api/v1/children/7/calendar?start_date=2026-09-21");
  assert.equal(c.seen.filter((s) => s.url.includes("/calendar")).length, 1, "never retried");

  c.answer(() => problem({ ...PROBLEM("x", 418), type: "about:blank" }));
  assert.equal((await failure(client.lunchMenu(7))).problem, null);

  c.answer(() => new Response("<html>bad gateway</html>", { status: 502 }));
  const proxy = await failure(client.lunchMenu(7, { week: 3, fresh: true }));
  assert.deepEqual([proxy.kind, proxy.problem, proxy.retryable], ["upstream", null, true]);
  assert.equal(c.seen.at(-1)!.url, BASE + "/api/v1/children/7/lunch-menu?week=3&fresh=true");
  c.answer(() => new Response("gone", { status: 404 }));
  assert.equal((await failure(client.lunchMenu(7))).retryable, false);
  c.answer(() => new Response(null, { status: 500 }));
  assert.equal((await failure(client.lunchMenu(7))).problem, null, "no content type at all");

  c.answer(() => json({ ...SCHEDULE, startDate: undefined }));
  const drift = await failure(client.schedule(7));
  assert.deepEqual(
    [drift.kind, drift.problem, drift.retryable],
    ["upstream", "response-drift", false],
  );
  assert.match(drift.message, /Schedule schema: startDate invalid_type/);
  c.answer(() => new Response("not json", { status: 200 }));
  assert.equal((await failure(client.schedule(7))).problem, "response-drift");
  c.answer(() => problem({ ...PROBLEM("upstream", 502), kind: "nonsense" }));
  assert.equal((await failure(client.schedule(7))).problem, "response-drift");

  c.answer(() => json({ ...SCHEDULE, fetchedAt: "later" }));
  assert.equal(
    ((await client.schedule(7)) as Record<string, unknown>).fetchedAt,
    "later",
    "fields the client does not know pass through",
  );

  const offline = createClient({
    baseUrl: BASE,
    clientId: "app",
    tokens: memoryTokenStore({ accessToken: "A1", refreshToken: "R1" }),
    fetch: async () => {
      throw new TypeError("fetch failed");
    },
  });
  const network = await failure(offline.children());
  assert.deepEqual([network.kind, network.retryable, network.status], ["network", true, null]);
  assert.ok(network.cause instanceof TypeError);
});

test("the store is loaded once; a refresh without expires_in keeps no expiry", async () => {
  let loads = 0;
  const saved: Tokens[] = [];
  const client = createClient({
    baseUrl: BASE,
    clientId: "app",
    tokens: {
      load: async () => {
        loads++;
        return { accessToken: "old", refreshToken: "R" };
      },
      save: async (tokens) => {
        saved.push(tokens);
      },
      clear: async () => {},
    },
    fetch: async (input, init) => {
      if (String(input).endsWith("/token"))
        return json({ access_token: "new", refresh_token: "R2" });
      return new Headers(init?.headers).get("authorization") === "Bearer new"
        ? json({ children: [], childInFocus: null })
        : json({ error: "invalid_token" }, 401);
    },
  });
  assert.deepEqual(await client.children(), { children: [], childInFocus: null });
  assert.deepEqual(await client.children(), { children: [], childInFocus: null });
  assert.equal(loads, 1);
  assert.deepEqual(saved, [{ accessToken: "new", refreshToken: "R2" }]);
  // While a refresh runs, accessToken() waits for it rather than handing out the old token.
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const waiting = createClient({
    baseUrl: BASE,
    clientId: "app",
    tokens: memoryTokenStore({ accessToken: "A", refreshToken: "R", expiresAt: 0 }),
    fetch: async () => {
      await held;
      return json({ access_token: "B", refresh_token: "R2", expires_in: 300 });
    },
  });
  const first = waiting.accessToken();
  await new Promise((resolve) => setImmediate(resolve));
  const second = waiting.accessToken();
  release();
  assert.deepEqual(await Promise.all([first, second]), ["B", "B"]);
});

test("the generated table and schemas cover every method's route", () => {
  assert.deepEqual(Object.keys(ROUTES), [
    "getSession",
    "listChildren",
    "getSchedule",
    "getCalendar",
    "getLunchMenu",
    "getOverview",
  ]);
  assert.equal(ROUTES.getOverview.path, "/children/{childId}/overview");
  assert.deepEqual(ROUTES.getOverview.query, ["date", "fresh"]);
  assert.ok(SCHEMAS.Overview);
  assert.deepEqual(validate("Schedule", SCHEDULE), SCHEDULE);
  assert.throws(() => validate("Schedule", {}), ConnectorError);
});

test("a 401 that arrives after another call lost the connection fails without a refresh", async () => {
  const c = connector();
  const client = createClient({
    baseUrl: BASE,
    clientId: "app",
    tokens: memoryTokenStore({ accessToken: "A1", refreshToken: "R1" }),
    fetch: c.fetch,
  });
  c.revoke();
  let release!: () => void;
  c.delayNextUnauthorized(new Promise<void>((resolve) => (release = resolve)));
  const late = client.schedule(7, { week: 1 });
  while (c.seen.length < 1) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    (await client.schedule(7, { week: 2 }).then(unexpected, (e: unknown) => e as ConnectorError))
      .problem,
    "oauth-token",
  );
  release();
  const error = await late.then(unexpected, (e: unknown) => e as ConnectorError);
  assert.deepEqual([error.problem, error.status], ["oauth-token", null]);
  assert.equal(c.refreshes(), 1);
});

test("without a fetch option the client uses the global one", async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    calls.push(String(input));
    return json({ children: [], childInFocus: null });
  });
  const client = createClient({
    baseUrl: BASE,
    clientId: "app",
    tokens: memoryTokenStore({ accessToken: "A1", refreshToken: "R1" }),
  });
  assert.deepEqual(await client.children(), { children: [], childInFocus: null });
  assert.deepEqual(calls, [BASE + "/api/v1/children"]);
});
