/**
 * The reference page's browser module (src/http/reference/app.ts) in Node: the week model
 * and rendering against typed fixtures, and the OAuth client and reads against a scripted
 * fake of the browser (fetch, sessionStorage, location, history, crypto, the root element).
 * The same module against the real connector is test/functional/http-reference.test.ts.
 */
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { test } from "node:test";
import {
  isoWeekDate,
  type CalendarEvent,
  type Lesson,
  type LunchDay,
} from "../../src/core/index.js";
import {
  ReferencePage,
  boot,
  browserEnv,
  esc,
  renderMessage,
  renderWeek,
  section,
  stockholmDate,
  weekOf,
  type BrowserGlobals,
  type CalendarBody,
  type Env,
  type FetchInit,
  type HttpResponse,
  type LunchBody,
  type ScheduleBody,
  type Section,
  type SessionBody,
  type WeekView,
} from "../../src/http/reference/app.js";

const origin = "https://connector.example";
const ALVA = { id: 201, firstName: "Alva" };
const BO = { id: 202, firstName: "Bo" };
/** Week 37 of 2026: Monday 7 September. */
const WEEK = weekOf("2026-09-09");
const NOW = new Date("2026-09-09T10:00:00Z");

const lesson = (over: Partial<Lesson> = {}): Lesson => ({
  id: "l1",
  title: "Matematik",
  start: "2026-09-07T08:00:00+02:00",
  end: "2026-09-07T09:00:00+02:00",
  room: "B12",
  group: "7A",
  teacher: "Ada",
  note: null,
  ...over,
});
const event = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: "e1",
  kind: "event",
  title: "Friluftsdag",
  allDay: true,
  start: "2026-09-08",
  end: "2026-09-08",
  location: null,
  teacher: null,
  group: null,
  category: null,
  note: null,
  ...over,
});
const lunchDay = (over: Partial<LunchDay> = {}): LunchDay => ({
  date: "2026-09-07",
  weekday: 1,
  dishes: [{ kind: "Lunch", description: "Pannkakor" }],
  ...over,
});
const schedule = (child = ALVA, lessons: Lesson[] = [lesson()]): ScheduleBody => ({
  week: 37,
  child,
  lessons,
});
const lunch = (child = ALVA, days: LunchDay[] = [lunchDay()]): LunchBody => ({
  year: 2026,
  week: 37,
  child,
  days,
});
const calendar = (child = ALVA, events: CalendarEvent[] = [event()]): CalendarBody => ({
  startDate: "2026-09-07",
  endDate: "2026-09-13",
  timezone: "Europe/Stockholm",
  child,
  events,
});
const ok = <T>(data: T): Section<T> => ({ state: "ok", data });
function view(over: Partial<WeekView> = {}): WeekView {
  return {
    origin,
    children: [ALVA],
    child: ALVA,
    week: WEEK,
    schedule: ok(schedule()),
    lunch: ok(lunch()),
    calendar: ok(calendar()),
    ...over,
  };
}

// ---------- Week model ----------

test("weeks agree with the core's ISO week arithmetic across year boundaries", () => {
  const start = Date.parse("2020-12-20T00:00:00Z");
  const dates = Array.from({ length: 30 }, (_, i) =>
    new Date(start + i * 86_400_000).toISOString().slice(0, 10),
  ).concat(["2026-09-07", "2026-09-13", "2026-12-31", "2027-01-03", "2027-01-04"]);
  for (const date of dates) {
    const week = weekOf(date);
    assert.ok(week.days.includes(date), date);
    const year = Number(week.days[3].slice(0, 4));
    week.days.forEach((day, i) => assert.equal(day, isoWeekDate(year, week.week, i + 1), date));
  }
  assert.equal(weekOf("2020-12-31").week, 53);
  assert.equal(weekOf("2027-01-03").week, 53);
  assert.deepEqual(weekOf("2026-09-26", -2), WEEK);
  assert.equal(weekOf("2026-12-28", 1).week, 1);
  assert.equal(WEEK.week, 37);
  assert.equal(WEEK.days[0], "2026-09-07");
});

test("today is taken in Stockholm, whatever the browser's timezone", () => {
  assert.equal(stockholmDate(new Date("2026-09-27T22:30:00Z")), "2026-09-28");
  assert.equal(stockholmDate(new Date("2026-01-15T23:30:00Z")), "2026-01-16");
  assert.equal(stockholmDate(new Date("2026-01-15T22:30:00Z")), "2026-01-15");
});

// ---------- One child, always ----------

test("an answer is kept only for the child the page asked for", () => {
  assert.deepEqual(section(200, schedule(ALVA), ALVA.id), ok(schedule(ALVA)));
  assert.deepEqual(section(200, schedule(BO), ALVA.id), { state: "other-child" });
  assert.deepEqual(section(200, { lessons: [] }, ALVA.id), { state: "other-child" });
  assert.deepEqual(section(200, null, ALVA.id), { state: "problem", status: 200, problem: {} });
  assert.deepEqual(section(403, { title: "Child not permitted" }, ALVA.id), {
    state: "problem",
    status: 403,
    problem: { title: "Child not permitted" },
  });
  assert.deepEqual(section(502, null, ALVA.id), { state: "problem", status: 502, problem: {} });
});

// ---------- Rendering ----------

test("a week renders lessons, lunch and school events per day, Monday to Friday", () => {
  const html = renderWeek(
    view({
      schedule: ok(
        schedule(ALVA, [
          lesson({
            id: "b",
            title: "Svenska",
            start: "2026-09-07T10:00:00+02:00",
            end: "2026-09-07T11:00:00+02:00",
            room: null,
            teacher: null,
          }),
          lesson(),
          lesson({
            id: "c",
            title: "Engelska",
            start: "2026-09-09T13:15:00+02:00",
            end: "2026-09-09T14:00:00+02:00",
          }),
          lesson({ id: "old", title: "Last week", start: "2026-08-31T08:00:00+02:00" }),
        ]),
      ),
      lunch: ok(
        lunch(ALVA, [
          lunchDay(),
          lunchDay({
            date: "2026-09-08",
            weekday: 2,
            dishes: [
              { kind: null, description: "Soppa" },
              { kind: "Vegetarisk", description: "Linsgryta" },
            ],
          }),
        ]),
      ),
      calendar: ok(
        calendar(ALVA, [
          event(),
          event({
            id: "t",
            allDay: false,
            start: "2026-09-10T18:00:00+02:00",
            end: "2026-09-10T19:00:00+02:00",
            title: "Föräldramöte",
            location: "Aulan",
          }),
          event({
            id: "l",
            kind: "lesson",
            title: "Matematik (calendar copy)",
            start: "2026-09-07",
          }),
        ]),
      ),
    }),
  );
  assert.match(html, /<h1>Week 37: Alva<\/h1>/);
  const days = html.split('<section class="day">').slice(1);
  assert.deepEqual(
    days.map((day) => /<h2>([^<]+)<\/h2>/.exec(day)![1]),
    ["Mon 7 Sep", "Tue 8 Sep", "Wed 9 Sep", "Thu 10 Sep", "Fri 11 Sep"],
    "no weekend without entries",
  );
  // Monday: lessons in time order, then lunch; room and teacher only when given.
  assert.match(
    days[0],
    /<li>08:00–09:00 Matematik, B12, Ada<\/li><li>10:00–11:00 Svenska<\/li><li class="lunch">Lunch: Pannkakor<\/li>/,
  );
  assert.match(
    days[1],
    /<li class="event">All day Friluftsdag<\/li><li class="lunch">Lunch: Soppa<\/li><li class="lunch">Lunch: Vegetarisk: Linsgryta<\/li>/,
  );
  assert.match(days[2], /13:15–14:00 Engelska/);
  assert.match(days[3], /<li class="event">18:00 Föräldramöte, Aulan<\/li>/);
  assert.match(days[4], /Nothing listed\./);
  assert.doesNotMatch(
    html,
    /Last week|calendar copy/,
    "other weeks and the calendar's lessons are left out",
  );
  assert.doesNotMatch(html, /<select/, "one child: no picker");
  assert.doesNotMatch(html, /class="notice"/);
});

test("a weekend day appears only when it has an entry", () => {
  const html = renderWeek(
    view({
      calendar: ok(
        calendar(ALVA, [event({ start: "2026-09-13", end: "2026-09-13", title: "Loppis" })]),
      ),
    }),
  );
  assert.match(html, /<h2>Sun 13 Sep<\/h2><ul><li class="event">All day Loppis/);
  assert.doesNotMatch(html, /Sat 12 Sep/);
});

test("every value from the API is escaped", () => {
  const hostile = '<img src=x onerror="alert(1)">';
  const html = renderWeek(
    view({
      children: [
        { id: 201, firstName: hostile },
        { id: 202, firstName: "Bo" },
      ],
      child: { id: 201, firstName: hostile },
      schedule: ok(schedule(ALVA, [lesson({ title: hostile, room: hostile })])),
      lunch: ok(lunch(ALVA, [lunchDay({ dishes: [{ kind: hostile, description: hostile }] })])),
      calendar: ok(calendar(ALVA, [event({ title: hostile, location: hostile })])),
    }),
  );
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.equal(esc(`&<>"'`), "&amp;&lt;&gt;&quot;&#39;");
  assert.equal(
    renderMessage("<b>", "<i>", "<p>extra</p>"),
    "<h1>&lt;b&gt;</h1><p>&lt;i&gt;</p><p>extra</p>",
  );
});

test("several children get a picker with the shown child selected", () => {
  const html = renderWeek(
    view({
      children: [ALVA, BO],
      child: BO,
      schedule: ok(schedule(BO)),
      lunch: ok(lunch(BO)),
      calendar: ok(calendar(BO)),
    }),
  );
  assert.match(
    html,
    /<select data-action="child"><option value="201">Alva<\/option><option value="202" selected>Bo<\/option><\/select>/,
  );
  assert.match(html, /<h1>Week 37: Bo<\/h1>/);
});

test("a section that is missing, refused or for another child says so instead of showing data", () => {
  const html = renderWeek(
    view({
      schedule: { state: "not-granted" },
      lunch: { state: "other-child" },
      calendar: {
        state: "problem",
        status: 502,
        problem: { title: "Response drift", detail: "<b>changed</b>", hint: "Try later." },
      },
    }),
  );
  assert.match(html, /Lessons: not granted to this page/);
  assert.match(html, /Lunch: the answer was for another child and is not shown/);
  assert.match(html, /School events: Response drift &lt;b&gt;changed&lt;\/b&gt; Try later\./);
  assert.match(html, /Nothing listed/);
  assert.doesNotMatch(html, /Pannkakor|Matematik|Friluftsdag/);
  const bare = renderWeek(view({ lunch: { state: "problem", status: 504, problem: {} } }));
  assert.match(bare, /Lunch: HTTP 504/);
});

test("a 409 links to the owner dashboard, and only on the page's own origin", () => {
  const signedOut = (ownerDashboard?: string) =>
    renderWeek(
      view({
        schedule: {
          state: "problem",
          status: 409,
          problem: {
            title: "SchoolSoft sign-in needed",
            ...(ownerDashboard === undefined ? {} : { ownerDashboard }),
          },
        },
      }),
    );
  assert.match(
    signedOut(origin + "/owner"),
    /<a href="https:\/\/connector\.example\/owner">Open the owner dashboard<\/a>/,
  );
  for (const other of ["https://evil.example/owner", "javascript:alert(1)", "not a url", undefined])
    assert.doesNotMatch(signedOut(other), /<a /, String(other));
  const forbidden = renderWeek(
    view({
      schedule: { state: "problem", status: 403, problem: { ownerDashboard: origin + "/owner" } },
    }),
  );
  assert.doesNotMatch(forbidden, /<a /, "only a 409 offers the dashboard");
});

// ---------- The page against a fake browser ----------

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}
type Answer = HttpResponse | Promise<HttpResponse>;
const reply = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): HttpResponse => ({
  status,
  headers: { get: (name) => headers[name.toLowerCase()] ?? null },
  json: async () => {
    if (body === undefined) throw new SyntaxError("not JSON");
    return structuredClone(body);
  },
});
const session = (
  over: Partial<SessionBody> = {},
  schoolsoft: Partial<SessionBody["schoolsoft"]> = {},
): SessionBody => ({
  schoolsoft: {
    signedIn: true,
    loginInProgress: false,
    webSession: false,
    portal: { state: "ok", retryAt: null },
    ...schoolsoft,
  },
  children: [ALVA],
  scopes: ["get_schedule", "get_lunch_menu", "get_calendar"],
  routes: [
    { operation: "get_schedule", method: "GET", path: "/api/v1/children/{childId}/schedule" },
    { operation: "get_calendar", method: "GET", path: "/api/v1/children/{childId}/calendar" },
    { operation: "get_lunch_menu", method: "GET", path: "/api/v1/children/{childId}/lunch-menu" },
  ],
  ownerDashboard: origin + "/owner",
  connectionExpiresAt: "2026-10-09T10:00:00.000Z",
  ...over,
});
const ENDPOINTS = {
  resource: origin + "/mcp",
  registration: origin + "/register",
  authorization: origin + "/authorize",
  token: origin + "/token",
  revocation: origin + "/revoke",
};
const CONNECTED = { client: { id: "client-1", endpoints: ENDPOINTS }, refresh: "refresh-1" };

/** Answers a REST read for whichever child the path names. */
function portal(path: string): HttpResponse | undefined {
  const match = /^\/api\/v1\/children\/(\d+)\/(schedule|lunch-menu|calendar)\?/.exec(path);
  if (!match) return undefined;
  const child = Number(match[1]) === BO.id ? BO : ALVA;
  return reply(
    200,
    match[2] === "schedule"
      ? schedule(child)
      : match[2] === "lunch-menu"
        ? lunch(child)
        : calendar(child),
  );
}

function browser(
  handler: (call: Call) => Answer | undefined,
  { href = origin + "/reference/", saved }: { href?: string; saved?: object } = {},
) {
  const calls: Call[] = [];
  const store = new Map<string, string>();
  if (saved) store.set("schoolsoft-reference", JSON.stringify(saved));
  const listeners = new Map<string, (event: { target: unknown }) => unknown>();
  const assigned: string[] = [];
  const replaced: string[] = [];
  let access = "access-1";
  let rotation = 1;
  let randomness = 0;
  const env: Env = {
    origin,
    href,
    assign: (url) => void assigned.push(url),
    replaceUrl: (url) => void replaced.push(url),
    storage: {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => void store.set(key, value),
      removeItem: (key) => void store.delete(key),
    },
    fetch: async (url: string, init: FetchInit = {}) => {
      const call = {
        method: init.method ?? "GET",
        url,
        headers: init.headers ?? {},
        body: init.body,
      };
      calls.push(call);
      const answer = await handler(call);
      if (answer) return answer;
      // Defaults: a connected, signed-in connector with the current access token.
      if (url === ENDPOINTS.token) {
        rotation++;
        access = `access-${rotation}`;
        return reply(200, { access_token: access, refresh_token: `refresh-${rotation}` });
      }
      if (call.headers.Authorization !== `Bearer ${access}`)
        return reply(401, { title: "Invalid token" });
      if (url === "/api/v1/session") return reply(200, session());
      return portal(url) ?? reply(404, { title: "Not found" });
    },
    random: (bytes) => new Uint8Array(bytes).fill(++randomness),
    sha256: async (data) => new Uint8Array(createHash("sha256").update(data).digest()).buffer,
    now: () => NOW,
    root: {
      innerHTML: "",
      addEventListener: (type, listener) => void listeners.set(type, listener),
    },
  };
  const page = new ReferencePage(env);
  const target = (action: string | null, value?: string) => ({
    closest: (selector: string) =>
      selector === "[data-action]" && action !== null ? { getAttribute: () => action } : null,
    getAttribute: () => action,
    value,
  });
  return {
    env,
    page,
    calls,
    assigned,
    replaced,
    html: () => env.root.innerHTML,
    stored: () => JSON.parse(store.get("schoolsoft-reference") ?? "null"),
    click: (action: string | null) =>
      listeners.get("click")!({ target: target(action) }) as Promise<void>,
    clickOn: (element: unknown) => listeners.get("click")!({ target: element }) as Promise<void>,
    change: (action: string | null, value: string) =>
      listeners.get("change")!({ target: target(action, value) }) as Promise<void>,
    paths: () => calls.map((c) => `${c.method} ${c.url}`),
  };
}
const form = (body: string | undefined) => Object.fromEntries(new URLSearchParams(body));

test("without a connection the page shows only the connect step", async () => {
  const b = browser(() => undefined);
  await b.page.start();
  assert.match(b.html(), /data-action="connect"/);
  assert.deepEqual(b.calls, [], "nothing is read before connecting");
  // A stray click on the connect screen (no data-action, no element) does nothing.
  await b.clickOn(null);
  await b.clickOn({});
  await b.click(null);
  assert.deepEqual(b.calls, []);
});

test("connecting discovers the sign-in from the API's own challenge, registers and sends the parent to consent", async () => {
  const b = browser(({ url }) => {
    if (url === "/api/v1/session")
      return reply(
        401,
        { error: "invalid_token" },
        {
          "www-authenticate": `Bearer error="invalid_token", resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
        },
      );
    if (url === origin + "/.well-known/oauth-protected-resource/mcp")
      return reply(200, { resource: origin + "/mcp", authorization_servers: [origin + "/"] });
    if (url === origin + "/.well-known/oauth-authorization-server")
      return reply(200, {
        registration_endpoint: origin + "/register",
        authorization_endpoint: origin + "/authorize",
        token_endpoint: origin + "/token",
        revocation_endpoint: origin + "/revoke",
      });
    if (url === origin + "/register") return reply(201, { client_id: "client-1" });
  });
  await b.page.start();
  await b.click("connect");
  assert.deepEqual(b.paths(), [
    "GET /api/v1/session",
    `GET ${origin}/.well-known/oauth-protected-resource/mcp`,
    `GET ${origin}/.well-known/oauth-authorization-server`,
    `POST ${origin}/register`,
  ]);
  assert.equal(b.calls[0].headers.Authorization, undefined, "the probe carries no token");
  assert.deepEqual(JSON.parse(b.calls[3].body!), {
    client_name: "Reference page",
    redirect_uris: [origin + "/reference/"],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
  });
  const saved = b.stored();
  assert.deepEqual(saved.client, CONNECTED.client);
  assert.equal(saved.refresh, undefined);
  const { verifier, state } = saved.pending;
  assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.match(state, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(verifier, state);
  assert.equal(b.assigned.length, 1);
  const authorize = new URL(b.assigned[0]);
  assert.equal(authorize.origin + authorize.pathname, origin + "/authorize");
  assert.deepEqual(Object.fromEntries(authorize.searchParams), {
    response_type: "code",
    client_id: "client-1",
    redirect_uri: origin + "/reference/",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    state,
    scope: "get_schedule get_lunch_menu get_calendar",
    resource: origin + "/mcp",
  });
});

test("discovery refuses answers that are missing, broken or point at another site", async () => {
  const challenge = (metadata: string) => ({
    "www-authenticate": `Bearer resource_metadata="${metadata}"`,
  });
  const cases: [string, (call: Call) => Answer | undefined][] = [
    ["the API did not name its sign-in", () => reply(200, {})],
    ["the API did not name its sign-in", () => reply(401, {})],
    [
      "the connector named another site",
      () => reply(401, {}, challenge("https://evil.example/meta")),
    ],
    [
      "the connector named another site",
      ({ url }) =>
        url === "/api/v1/session"
          ? reply(401, {}, challenge(origin + "/meta"))
          : reply(200, {
              resource: origin + "/mcp",
              authorization_servers: ["https://evil.example/"],
            }),
    ],
    [
      `${origin}/meta answered 500`,
      ({ url }) =>
        url === "/api/v1/session" ? reply(401, {}, challenge(origin + "/meta")) : reply(500, {}),
    ],
    [
      `${origin}/meta answered 200`,
      ({ url }) =>
        url === "/api/v1/session"
          ? reply(401, {}, challenge(origin + "/meta"))
          : reply(200, undefined),
    ],
    ["Failed to fetch", () => Promise.reject(new TypeError("Failed to fetch"))],
  ];
  for (const [message, handler] of cases) {
    const b = browser(handler);
    await b.page.start();
    await b.click("connect");
    assert.match(b.html(), new RegExp(`Could not start connecting: ${message}\\.`), message);
    assert.match(b.html(), /data-action="connect"/);
    assert.deepEqual(b.assigned, []);
  }
});

test("back from consent, the page cleans the address, checks state, exchanges the code and shows the week", async () => {
  const pending = { state: "state-1", verifier: "verifier-1" };
  const b = browser(() => undefined, {
    href: `${origin}/reference/?code=code-1&state=state-1`,
    saved: { client: CONNECTED.client, pending },
  });
  await b.page.start();
  assert.deepEqual(b.replaced, ["/reference/"], "the code leaves the address bar first");
  assert.equal(b.calls[0].url, ENDPOINTS.token);
  assert.equal(b.calls[0].method, "POST");
  assert.deepEqual(form(b.calls[0].body), {
    grant_type: "authorization_code",
    code: "code-1",
    code_verifier: "verifier-1",
    redirect_uri: origin + "/reference/",
    client_id: "client-1",
    resource: origin + "/mcp",
  });
  assert.deepEqual(b.paths().slice(1), [
    "GET /api/v1/session",
    "GET /api/v1/children/201/schedule?week=37",
    "GET /api/v1/children/201/lunch-menu?week=37",
    "GET /api/v1/children/201/calendar?start_date=2026-09-07&end_date=2026-09-13",
  ]);
  assert.match(b.html(), /<h1>Week 37: Alva<\/h1>/);
  assert.match(b.html(), /08:00–09:00 Matematik/);
  assert.match(b.html(), /Pannkakor/);
  assert.match(b.html(), /Friluftsdag/);
  // The access token lives in memory only; the refresh token is kept for a reload.
  assert.deepEqual(b.stored(), { client: CONNECTED.client, refresh: "refresh-2" });
  assert.doesNotMatch(JSON.stringify(b.stored()), /access-/);
});

test("a callback the tab did not start, or a refusal, never reaches the token endpoint", async () => {
  const cases: [string, object | undefined, RegExp][] = [
    [
      "?code=c&state=forged",
      { client: CONNECTED.client, pending: { state: "s", verifier: "v" } },
      /not started from this tab/,
    ],
    ["?code=c&state=s", undefined, /not started from this tab/],
    ["?code=c&state=s", { pending: { state: "s", verifier: "v" } }, /not started from this tab/],
    [
      "?state=s",
      { client: CONNECTED.client, pending: { state: "s", verifier: "v" } },
      /Access was not granted/,
    ],
    [
      "?error=access_denied&state=s",
      { client: CONNECTED.client, pending: { state: "s", verifier: "v" } },
      /Access was not granted/,
    ],
    [
      "?error=access_denied",
      { client: CONNECTED.client, pending: { state: "s", verifier: "v" } },
      /not started from this tab/,
    ],
  ];
  for (const [query, saved, expected] of cases) {
    const b = browser(() => undefined, { href: `${origin}/reference/${query}`, saved });
    await b.page.start();
    assert.deepEqual(b.replaced, ["/reference/"], query);
    assert.deepEqual(b.calls, [], query);
    assert.match(b.html(), expected, query);
    assert.equal(b.stored().pending, undefined, "a pending sign-in is used at most once");
  }
});

test("a refused or failing code exchange ends in the connect step or a retry message", async () => {
  const saved = { client: CONNECTED.client, pending: { state: "s", verifier: "v" } };
  const refused = browser(() => reply(400, { error: "invalid_grant" }), {
    href: `${origin}/reference/?code=c&state=s`,
    saved,
  });
  await refused.page.start();
  assert.match(refused.html(), /Could not finish connecting/);
  assert.match(refused.html(), /data-action="connect"/);
  const failing = browser(() => reply(503, undefined), {
    href: `${origin}/reference/?code=c&state=s`,
    saved,
  });
  await failing.page.start();
  assert.match(failing.html(), /Could not reach the connector.*the token endpoint answered 503/);
  assert.match(failing.html(), /data-action="reload"/);
});

test("after a reload the refresh token brings the access token back without new consent", async () => {
  const b = browser(() => undefined, { saved: CONNECTED });
  await b.page.start();
  assert.equal(b.calls[0].url, ENDPOINTS.token);
  assert.deepEqual(form(b.calls[0].body), {
    grant_type: "refresh_token",
    refresh_token: "refresh-1",
    client_id: "client-1",
    resource: origin + "/mcp",
  });
  assert.match(b.html(), /Week 37: Alva/);
  assert.equal(b.stored().refresh, "refresh-2", "rotated");
});

test("a revoked grant sends the page back to the connect step and forgets the tokens", async () => {
  const b = browser(
    ({ url }) => (url === ENDPOINTS.token ? reply(400, { error: "invalid_grant" }) : undefined),
    {
      saved: CONNECTED,
    },
  );
  await b.page.start();
  assert.match(b.html(), /connection has ended/);
  assert.match(b.html(), /data-action="connect"/);
  assert.equal(b.stored().refresh, undefined);
  assert.deepEqual(b.paths(), [`POST ${ENDPOINTS.token}`], "no data read without a token");
  // Without a refresh token or client, nothing is attempted at all.
  await b.click("next");
  assert.deepEqual(b.paths(), [`POST ${ENDPOINTS.token}`]);
  assert.match(b.html(), /connection has ended/);
});

test("an expired access token is refreshed once for parallel reads, then each read is retried", async () => {
  let expireOnce = true;
  const b = browser(
    ({ url, headers }) => {
      // The session read succeeds; then the token expires while the three reads are in flight.
      if (url.includes("/children/") && headers.Authorization === "Bearer access-2" && expireOnce)
        return new Promise((resolve) => setTimeout(() => resolve(reply(401, {})), 5));
      return undefined;
    },
    { saved: CONNECTED },
  );
  await b.page.start();
  expireOnce = false;
  const tokenCalls = b.calls.filter((c) => c.url === ENDPOINTS.token);
  assert.equal(tokenCalls.length, 2, "one refresh at start, one shared by the three 401s");
  assert.equal(form(tokenCalls[1].body).refresh_token, "refresh-2");
  assert.equal(b.calls.filter((c) => c.url.includes("/schedule")).length, 2);
  assert.match(b.html(), /Week 37: Alva/);
  assert.match(b.html(), /Matematik/);
});

test("a read refused as unauthorized after a failed refresh ends the connection", async () => {
  const b = browser(
    ({ url }) => {
      if (url.includes("/children/")) return reply(401, {});
      if (url === ENDPOINTS.token && b.calls.length > 2)
        return reply(401, { error: "invalid_client" });
    },
    { saved: CONNECTED },
  );
  await b.page.start();
  assert.match(b.html(), /connection has ended/);
  assert.equal(b.stored().refresh, undefined);
});

test("a session answer the page cannot use is shown as a problem with a retry", async () => {
  const limited = browser(
    ({ url }) =>
      url === "/api/v1/session"
        ? reply(429, { title: "Too many requests", detail: "Wait a minute." })
        : undefined,
    { saved: CONNECTED },
  );
  await limited.page.start();
  assert.match(
    limited.html(),
    /The connector could not answer<\/h1><p>Too many requests Wait a minute\.<\/p>/,
  );
  assert.match(limited.html(), /data-action="reload"/);
  const broken = browser(
    ({ url }) => (url === "/api/v1/session" ? reply(500, undefined) : undefined),
    { saved: CONNECTED },
  );
  await broken.page.start();
  assert.match(broken.html(), /<p>HTTP 500<\/p>/);
  const offline = browser(
    ({ url }) =>
      url === "/api/v1/session" ? Promise.reject(new TypeError("Failed to fetch")) : undefined,
    { saved: CONNECTED },
  );
  await offline.page.start();
  assert.match(offline.html(), /Could not reach the connector<\/h1><p>Failed to fetch\./);
});

test("a signed-out connector, a pushing-back portal and an empty grant each get their own message", async () => {
  const withSession = (body: SessionBody) =>
    browser(({ url }) => (url === "/api/v1/session" ? reply(200, body) : undefined), {
      saved: CONNECTED,
    });
  const out = withSession(session({}, { signedIn: false }));
  await out.page.start();
  assert.match(out.html(), /not signed in to SchoolSoft<\/h1><p>The parent signs in with BankID/);
  assert.match(
    out.html(),
    /<a href="https:\/\/connector\.example\/owner">Open the owner dashboard<\/a>/,
  );
  assert.equal(out.calls.filter((c) => c.url.includes("/children/")).length, 0);
  const waiting = withSession(
    session(
      { ownerDashboard: "https://evil.example/owner" },
      { signedIn: false, loginInProgress: true },
    ),
  );
  await waiting.page.start();
  assert.match(waiting.html(), /waiting for BankID/);
  assert.doesNotMatch(waiting.html(), /<a /, "a dashboard on another site is not linked");
  const paused = withSession(
    session({}, { portal: { state: "paused", retryAt: "2026-09-09T11:00:00.000Z" } }),
  );
  await paused.page.start();
  assert.match(
    paused.html(),
    /pushing back<\/h1><p>The connector sends it nothing until 2026-09-09T11:00:00.000Z/,
  );
  const probing = withSession(session({}, { portal: { state: "probing", retryAt: null } }));
  await probing.page.start();
  assert.match(probing.html(), /until one request has tested it/);
  const empty = withSession(session({ children: [] }));
  await empty.page.start();
  assert.match(empty.html(), /covers no children/);
});

test("switching child reads only that child's routes, and an answer for another child is never shown", async () => {
  const b = browser(
    ({ url }) => {
      if (url === "/api/v1/session") return reply(200, session({ children: [ALVA, BO] }));
      // A faulty answer: Bo's lunch route answers with Alva's menu.
      if (url.startsWith("/api/v1/children/202/lunch-menu")) return reply(200, lunch(ALVA));
    },
    { saved: CONNECTED },
  );
  await b.page.start();
  assert.match(b.html(), /Week 37: Alva/);
  const before = b.calls.length;
  await b.change("child", "202");
  const reads = b.calls.slice(before).filter((c) => c.url.includes("/children/"));
  assert.deepEqual(
    reads.map((c) => c.url.split("?")[0]),
    [
      "/api/v1/children/202/schedule",
      "/api/v1/children/202/lunch-menu",
      "/api/v1/children/202/calendar",
    ],
  );
  assert.match(b.html(), /Week 37: Bo/);
  assert.match(b.html(), /Lunch: the answer was for another child and is not shown/);
  assert.doesNotMatch(b.html(), /Pannkakor/);
  // A change from anything but the child selector is ignored.
  const count = b.calls.length;
  await b.change("other", "201");
  assert.equal(b.calls.length, count);
  // A remembered child that left the grant falls back to the first one.
  const gone = browser(
    ({ url }) =>
      url === "/api/v1/session" ? reply(200, session({ children: [ALVA] })) : undefined,
    { saved: CONNECTED },
  );
  await gone.page.start();
  await gone.change("child", "202");
  assert.match(gone.html(), /Week 37: Alva/);
});

test("an older load finishing late never replaces what a newer one shows", async () => {
  // First load: the session answer is held back until the second load has finished.
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  let sessions = 0;
  const b = browser(
    ({ url }) => {
      if (url === "/api/v1/session" && ++sessions === 1)
        return held.then(() => reply(200, session({ children: [ALVA, BO] })));
      if (url === "/api/v1/session") return reply(200, session({ children: [ALVA, BO] }));
    },
    { saved: CONNECTED },
  );
  const first = b.page.start();
  await new Promise((resolve) => setTimeout(resolve, 5));
  await b.change("child", "202");
  assert.match(b.html(), /Week 37: Bo/);
  release();
  await first;
  assert.match(b.html(), /Week 37: Bo/, "the late first answer is dropped");

  // Stale after the sections: the section reads of the first load are held instead.
  let releaseReads!: () => void;
  const heldReads = new Promise<void>((resolve) => (releaseReads = resolve));
  let reads = 0;
  const c = browser(
    ({ url }) => {
      if (url === "/api/v1/session") return reply(200, session({ children: [ALVA, BO] }));
      if (url.includes("/children/201/") && ++reads <= 3) return heldReads.then(() => portal(url)!);
    },
    { saved: CONNECTED },
  );
  const firstLoad = c.page.start();
  await new Promise((resolve) => setTimeout(resolve, 5));
  await c.change("child", "202");
  releaseReads();
  await firstLoad;
  assert.match(c.html(), /Week 37: Bo/);
  assert.doesNotMatch(c.html(), /Week 37: Alva/);
});

test("previous, next and reload move the week and read it again", async () => {
  const b = browser(() => undefined, { saved: CONNECTED });
  await b.page.start();
  const weeks = () =>
    b.calls.filter((c) => c.url.includes("/schedule")).map((c) => new URL(c.url, origin).search);
  await b.click("next");
  await b.click("prev");
  await b.click("prev");
  await b.click("reload");
  assert.deepEqual(weeks(), [
    "?week=37",
    "?week=38",
    "?week=37",
    "?week=36",
    "?week=36&fresh=true",
  ]);
  assert.match(b.html(), /Week 36: Alva/);
  assert.ok(
    b.calls.some((c) => c.url.endsWith("calendar?start_date=2026-08-31&end_date=2026-09-06")),
  );
});

test("a route the session does not list, or lists off the API, is shown as not granted", async () => {
  const b = browser(
    ({ url }) =>
      url === "/api/v1/session"
        ? reply(
            200,
            session({
              routes: [
                {
                  operation: "get_schedule",
                  method: "GET",
                  path: "https://evil.example/{childId}/schedule",
                },
                {
                  operation: "get_lunch_menu",
                  method: "GET",
                  path: "/api/v1/children/{childId}/lunch-menu",
                },
              ],
            }),
          )
        : undefined,
    { saved: CONNECTED },
  );
  await b.page.start();
  assert.match(b.html(), /Lessons: not granted/);
  assert.match(b.html(), /School events: not granted/);
  assert.match(b.html(), /Pannkakor/);
  assert.ok(!b.calls.some((c) => c.url.includes("evil") || c.url.includes("/schedule")));
});

test("disconnecting revokes the grant at the connector and forgets everything", async () => {
  const b = browser(() => undefined, { saved: CONNECTED });
  await b.page.start();
  await b.click("disconnect");
  const revoke = b.calls.at(-1)!;
  assert.equal(`${revoke.method} ${revoke.url}`, `POST ${ENDPOINTS.revocation}`);
  assert.deepEqual(form(revoke.body), { token: "refresh-2", client_id: "client-1" });
  assert.equal(b.stored(), null);
  assert.match(b.html(), /Disconnected/);
  assert.match(b.html(), /data-action="connect"/);
  // Revocation failing on the network still forgets locally; nothing saved means no request.
  const offline = browser(
    ({ url }) =>
      url === ENDPOINTS.revocation ? Promise.reject(new TypeError("offline")) : undefined,
    { saved: CONNECTED },
  );
  await offline.page.start();
  await offline.click("disconnect");
  assert.match(offline.html(), /Disconnected/);
  const empty = browser(() => undefined);
  await empty.page.start();
  await empty.click("disconnect");
  assert.deepEqual(empty.calls, []);
});

test("unreadable saved state counts as not connected", async () => {
  const b = browser(() => undefined);
  b.env.storage.setItem("schoolsoft-reference", "{not json");
  await b.page.start();
  assert.match(b.html(), /data-action="connect"/);
  assert.deepEqual(b.calls, []);
});

test("in a browser, boot wires the page to the real globals", async () => {
  const replaced: unknown[][] = [];
  const assigned: string[] = [];
  const fetched: string[] = [];
  const root = { innerHTML: "", addEventListener: () => {} };
  const store = new Map<string, string>();
  const globals: BrowserGlobals = {
    location: {
      href: origin + "/reference/?code=c&state=s",
      origin,
      assign: (url) => void assigned.push(url),
    },
    history: { replaceState: (...args) => void replaced.push(args) },
    sessionStorage: {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => void store.set(key, value),
      removeItem: (key) => void store.delete(key),
    },
    fetch: async (url) => {
      fetched.push(url);
      return reply(200, {});
    },
    crypto: webcrypto as unknown as BrowserGlobals["crypto"],
    document: { getElementById: (id) => (id === "app" ? root : null) },
  };
  await boot(globals);
  assert.deepEqual(replaced, [[null, "", "/reference/"]]);
  assert.match(root.innerHTML, /not started from this tab/);
  const env = browserEnv(globals);
  assert.equal(env.origin, origin);
  assert.equal(env.random(32).length, 32);
  assert.notDeepEqual(env.random(32), env.random(32));
  assert.equal(
    Buffer.from(await env.sha256(new TextEncoder().encode("abc"))).toString("hex"),
    createHash("sha256").update("abc").digest("hex"),
  );
  assert.ok(Math.abs(env.now().getTime() - Date.now()) < 5000);
  env.assign("/authorize");
  assert.deepEqual(assigned, ["/authorize"]);
  await env.fetch("/api/v1/session");
  assert.deepEqual(fetched, ["/api/v1/session"]);
});
