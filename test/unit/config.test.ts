import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveConfig,
  envSource,
  defaultConfigDir,
  NotConfiguredError,
} from "../../src/core/config.js";

const defaults = { home: "/home/u", platform: "linux" as const };

test("precedence: earlier sources win, defaults fill the rest", () => {
  const c = resolveConfig(
    [{ school: "flags" }, { school: "env", orgId: "20" }, { callbackPort: "5000" }],
    defaults,
  );
  assert.equal(c.school, "flags");
  assert.equal(c.orgId, "20");
  assert.equal(c.callbackPort, 5000);
  assert.equal(c.userType, "parent");
  assert.equal(c.clientId, "vApp", "parent default client id");
  assert.equal(c.configDir, "/home/u/.config/schoolsoft-agent");
  assert.equal(c.stateDir, "/home/u/.config/schoolsoft-agent/state");
});

test("student user type defaults to the eApp client id; explicit clientId wins", () => {
  assert.equal(resolveConfig([{ school: "s", userType: "student" }], defaults).clientId, "eApp");
  assert.equal(resolveConfig([{ school: "s", clientId: "custom" }], defaults).clientId, "custom");
});

test("missing school → NotConfiguredError naming configure", () => {
  assert.throws(() => resolveConfig([{}, { school: "" }], defaults), NotConfiguredError);
  assert.throws(() => resolveConfig([], defaults), /Not configured/);
});

test("invalid user type and port are rejected", () => {
  assert.throws(
    () => resolveConfig([{ school: "s", userType: "alien" }], defaults),
    /Invalid userType/,
  );
  assert.throws(
    () => resolveConfig([{ school: "s", callbackPort: "abc" }], defaults),
    /is not a port number/,
  );
  assert.throws(
    () => resolveConfig([{ school: "s", callbackPort: 70000 }], defaults),
    /is not a port number/,
  );
});

test("envSource maps SCHOOLSOFT_* and ignores empty strings", () => {
  const s = envSource({
    SCHOOLSOFT_SCHOOL: "taby",
    SCHOOLSOFT_ORGID: "",
    SCHOOLSOFT_CALLBACK_PORT: "4000",
    OTHER: "x",
  });
  assert.deepEqual(s, {
    provider: undefined,
    school: "taby",
    orgId: undefined,
    userType: undefined,
    clientId: undefined,
    callbackPort: "4000",
    stateDir: undefined,
    configDir: undefined,
    browserEngine: undefined,
    browserCdp: undefined,
  });
});

test("platform config dirs", () => {
  assert.equal(
    defaultConfigDir("/Users/j", "darwin"),
    "/Users/j/Library/Application Support/schoolsoft-agent",
  );
  assert.equal(
    defaultConfigDir("/home/j", "linux", { XDG_CONFIG_HOME: "/xdg" }),
    "/xdg/schoolsoft-agent",
  );
  assert.match(
    defaultConfigDir("C:\\Users\\j", "win32", { APPDATA: "C:\\Users\\j\\AppData\\Roaming" }),
    /Roaming[\\/]schoolsoft-agent$/,
  );
});

test("createSessionManager / createPortal wire a working manager without touching disk", async () => {
  const { createSessionManager, createPortal } = await import("../../src/core/wiring.js");
  const { MemorySessionStore } = await import("../../src/core/session/store.js");
  const config = resolveConfig([{ school: "taby", configDir: "/nowhere" }], defaults);
  const manager = createSessionManager(config, {
    store: new MemorySessionStore(),
    fetchImpl: async () => {
      throw new Error("no network in tests");
    },
    openBrowser: () => {},
  });
  const api = createPortal(manager);
  await assert.rejects(api.getParent(), /no access token/);
  await assert.rejects(api.getScheduleWeek(1), /no session cookies/);
  await assert.rejects(manager.ensureSession(), /Not logged in/);
});

test("browser engine config: chromium default, cdp needs an endpoint", () => {
  assert.deepEqual(resolveConfig([{ school: "s" }], defaults).browser, {
    kind: "chromium",
    headless: true,
  });
  assert.deepEqual(
    resolveConfig(
      [{ school: "s", browserEngine: "cdp", browserCdp: "ws://obscura:9222" }],
      defaults,
    ).browser,
    { kind: "cdp", endpoint: "ws://obscura:9222" },
  );
  assert.throws(
    () => resolveConfig([{ school: "s", browserEngine: "cdp" }], defaults),
    /CDP endpoint/,
  );
  assert.throws(
    () => resolveConfig([{ school: "s", browserEngine: "firefox" }], defaults),
    /browserEngine "firefox" is not supported/,
  );
  assert.deepEqual(
    envSource({ SCHOOLSOFT_BROWSER_ENGINE: "cdp", SCHOOLSOFT_BROWSER_CDP: "ws://x" }).browserEngine,
    "cdp",
  );
});

test("createPortal injects the web-login cookies into the browser session for gated pages", async () => {
  const { createSessionManager, createPortal } = await import("../../src/core/wiring.js");
  const { MemorySessionStore } = await import("../../src/core/session/store.js");
  const config = resolveConfig([{ school: "taby", configDir: "/nowhere" }], defaults);
  const store = new MemorySessionStore();
  const web = {
    savedAt: 1,
    landedOn: "https://sms.schoolsoft.se/taby/jsp/student/right_student_startpage.jsp",
    cookies: [{ name: "JSESSIONID", value: "web-cookie", domain: "sms.schoolsoft.se", path: "/" }],
  };
  const manager = createSessionManager(config, {
    store,
    fetchImpl: async () => {
      throw new Error("no network in tests");
    },
    openBrowser: () => {},
    webLogin: async () => web,
  });
  await manager.webLogin();
  assert.equal(manager.getWebSession()?.cookies.length, 1);
  const injected: { name: string; value: string }[] = [];
  const page = {
    addInitScript: async () => {},
    route: async () => {},
    goto: async () => {},
    url: () => "https://sms.schoolsoft.se/taby/jsp/student/right_student_gradesubject.jsp",
    evaluate: async () => ({ title: "Betyg", sections: [] }),
  };
  const context = {
    addCookies: async (c: typeof injected) => {
      injected.push(...c);
    },
    newPage: async () => page,
    close: async () => {},
  };
  const browser = { newContext: async () => context, close: async () => {} };
  const portal = createPortal(manager, {
    fetchImpl: async () => {
      throw new Error("no network in tests");
    },
    playwrightLoader: async () =>
      ({ chromium: { launch: async () => browser, connectOverCDP: async () => browser } }) as never,
  });
  const grades = await portal.getGrades();
  assert.equal(grades.title, "Betyg");
  await assert.rejects(
    portal.getGradePrognosis(),
    /Could not reach SchoolSoft \(no network in tests\)/,
    "web cookie header built and the request attempted",
  );
  assert.deepEqual(
    injected.map((c) => `${c.name}=${c.value}`),
    ["JSESSIONID=web-cookie"],
    "the web cookies, not the app cookie header, reach the browser for a gated page",
  );
  injected.length = 0;
  await assert.rejects(portal.getContacts(), /Not logged in/);
  assert.deepEqual(injected, [], "a non-gated page never gets the web cookies");
});

test("defaultConfigDir on win32 and linux honours APPDATA / XDG_CONFIG_HOME", async () => {
  assert.match(defaultConfigDir("/h", "win32", {}), /AppData[\\/]Roaming[\\/]schoolsoft-agent$/);
  assert.match(defaultConfigDir("/h", "win32", { APPDATA: "/ad" }), /^\/ad[\\/]schoolsoft-agent$/);
  assert.match(
    defaultConfigDir("/h", "linux", { XDG_CONFIG_HOME: "/xdg" }),
    /^\/xdg[\\/]schoolsoft-agent$/,
  );
});

test("createSessionManager defaults: file store in stateDir, web login runs a headed browser (chromium or cdp) and prints the URL", async () => {
  const { createSessionManager } = await import("../../src/core/wiring.js");
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const stateDir = join(mkdtempSync(join(tmpdir(), "state-")), "state");
  const launched: { headless: boolean }[] = [];
  const connected: string[] = [];
  const page = {
    goto: async () => {},
    url: () => "https://sms.schoolsoft.se/taby/jsp/student/right_student_startpage.jsp",
  };
  const context = {
    newPage: async () => page,
    pages: () => [page],
    cookies: async () => [
      { name: "JSESSIONID", value: "w", domain: "sms.schoolsoft.se", path: "/", expires: -1 },
    ],
  };
  const browser = { newContext: async () => context, close: async () => {} };
  const loader = async () =>
    ({
      chromium: {
        launch: async (o: { headless: boolean }) => (launched.push(o), browser),
        connectOverCDP: async (e: string) => (connected.push(e), browser),
      },
    }) as never;
  const logs: string[] = [];
  const orig = console.error;
  console.error = (m: string) => logs.push(m);
  try {
    const chromium = createSessionManager(
      resolveConfig([{ school: "taby", configDir: "/nowhere", stateDir }], defaults),
      { playwrightLoader: loader },
    );
    const r = await chromium.webLogin();
    assert.equal(r.status, "web_logged_in");
    assert.deepEqual(launched, [{ headless: false }]);
    const cdp = createSessionManager(
      resolveConfig(
        [
          {
            school: "taby",
            configDir: "/nowhere",
            stateDir,
            browserEngine: "cdp",
            browserCdp: "ws://obscura",
          },
        ],
        defaults,
      ),
      { playwrightLoader: loader },
    );
    await cdp.webLogin();
    assert.deepEqual(connected, ["ws://obscura"]);
  } finally {
    console.error = orig;
  }
  assert.match(
    logs[0],
    /Web login: complete BankID\/SAML in the browser window \(https:\/\/sms\.schoolsoft\.se\/taby\/\)/,
  );
});

test("createPortal honours an explicit null browser; web cookies are null without a web session", async () => {
  const { createSessionManager, createPortal, createBrowserSession } =
    await import("../../src/core/wiring.js");
  const { MemorySessionStore } = await import("../../src/core/session/store.js");
  const config = resolveConfig([{ school: "taby", configDir: "/nowhere" }], defaults);
  const manager = createSessionManager(config, {
    store: new MemorySessionStore(),
    fetchImpl: async () => {
      throw new Error("no network");
    },
    openBrowser: () => {},
  });
  const portal = createPortal(manager, {
    browser: null,
    browserUnavailableReason: "tests",
    fetchImpl: async () => {
      throw new Error("no network in tests");
    },
  });
  await assert.rejects(portal.getContacts(), /headless browser \(tests\)/);
  await assert.rejects(portal.getGradePrognosis(), /web login session/);
  const session = createBrowserSession(manager, {
    playwrightLoader: async () => {
      throw new Error("must not load");
    },
  });
  await assert.rejects(
    session.withPage(async () => 0, { web: true }),
    /web login session/,
  );
});

test("provider: defaults to schoolsoft, taken from SCHOOLSOFT_PROVIDER or a source, and resolved through the registry", async () => {
  const { resolveProvider } = await import("../../src/core/wiring.js");
  assert.equal(resolveConfig([{ school: "s" }], defaults).provider, "schoolsoft");
  assert.equal(envSource({ SCHOOLSOFT_PROVIDER: "other" }).provider, "other");
  assert.equal(resolveConfig([{ school: "s", provider: "other" }], defaults).provider, "other");
  assert.equal(resolveProvider(resolveConfig([{ school: "s" }], defaults)).id, "schoolsoft");
  assert.throws(
    () => resolveProvider({ provider: "other" }),
    /Unknown school portal provider "other"/,
  );
});

test("createPortal recovers a mid-session 401 by re-establishing the session and repeating the call", async () => {
  const { createSessionManager, createPortal } = await import("../../src/core/wiring.js");
  const { MemorySessionStore } = await import("../../src/core/session/store.js");
  const config = resolveConfig([{ school: "taby", configDir: "/nowhere" }], defaults);
  let rejectOnce = true;
  const calls: string[] = [];
  const jwt = (p: Record<string, unknown>) => {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
    return `${b64({ alg: "RS256" })}.${b64(p)}.sig`;
  };
  const parent = {
    userId: 21,
    firstName: "P",
    lastName: "T",
    children: [
      {
        studentId: 100,
        firstName: "E",
        lastName: "T",
        schools: [{ orgId: 20, name: "S", className: "4B" }],
      },
    ],
  };
  const fetchImpl = async (url: string, _s: string, _o: { headers?: Record<string, string> }) => {
    const path = url.replace(/^https:\/\/sms\.schoolsoft\.se\/taby/, "").split("?")[0];
    calls.push(path);
    if (path === "/rest-api/login/token")
      return {
        status: 200,
        data: { access_token: jwt({ exp: 9_999_999_999 }), refresh_token: "R2" },
        headers: {},
        setCookies: [],
      };
    if (path === "/eva/api/v1/parent")
      return { status: 200, data: parent, headers: {}, setCookies: [] };
    if (path === "/eva-apps/auth/login/parent")
      return {
        status: 303,
        data: "",
        headers: {},
        setCookies: ["JSESSIONID=j; Path=/", "hash=h; Path=/", "usertype=2; Path=/"],
      };
    if (path === "/rest-api/session") return { status: 200, data: {}, headers: {}, setCookies: [] };
    if (path === "/rest-api/parent/calendar/lessons/week/37") {
      if (rejectOnce) {
        rejectOnce = false;
        return { status: 401, data: null, headers: {}, setCookies: [] };
      }
      return { status: 200, data: [{ name: "Matte" }], headers: {}, setCookies: [] };
    }
    return { status: 404, data: null, headers: {}, setCookies: [] };
  };
  const store = new MemorySessionStore();
  store.save({
    provider: "schoolsoft",
    school: "taby",
    data: {
      accessToken: jwt({ exp: 9_999_999_999 }),
      refreshToken: "R1",
      accessTokenExpiresAt: 9_999_999_999,
    },
    guardian: { userId: 21, parentName: "P T", children: parent.children, childInFocus: 100 },
    savedAt: 1,
    authMethod: "bankid-browser",
  });
  const manager = createSessionManager(config, {
    store,
    fetchImpl: fetchImpl as never,
    openBrowser: () => {},
  });
  // the ssp-node client verifies the session via /rest-api/session; stub it to avoid a real request
  const session = manager.getSession() as unknown as { verify: () => Promise<boolean> };
  session.verify = async () => true;
  await manager.ensureSession();
  const portal = createPortal(manager, { browser: null, fetchImpl });
  const lessons = await portal.getScheduleWeek(37);
  assert.deepEqual(lessons, [{ name: "Matte" }]);
  const lessonCalls = calls.filter((c) => c.endsWith("/week/37"));
  assert.equal(lessonCalls.length, 2, "401 then the retry");
  assert.ok(
    calls.filter((c) => c === "/eva-apps/auth/login/parent").length >= 2,
    "cookies re-exchanged during recovery",
  );
});

test("createSessionManager: the login URL is recorded in the pending marker and a stale marker from a dead process is ignored", async () => {
  const { createSessionManager } = await import("../../src/core/wiring.js");
  const { MemorySessionStore } = await import("../../src/core/session/store.js");
  const { MemoryPendingLoginStore } = await import("../../src/core/session/pending-login.js");
  const config = resolveConfig(
    [{ school: "taby", configDir: "/nowhere", callbackPort: 43555 }],
    defaults,
  );
  const pending = new MemoryPendingLoginStore();
  pending.write({ state: "running", startedAt: Date.now(), pid: 2_000_000_000 });
  const opened: string[] = [];
  const manager = createSessionManager(config, {
    store: new MemorySessionStore(),
    pending,
    pid: 4,
    openBrowser: (url) => opened.push(url),
    fetchImpl: async () => {
      throw new Error("no network in tests");
    },
  });
  assert.equal(manager.pendingLogin(), null, "pid 2000000000 is not alive → cleared");
  pending.write({ state: "running", startedAt: Date.now(), pid: process.pid });
  assert.equal(manager.pendingLogin()?.pid, process.pid, "this test process is alive → kept");
  pending.clear();
  const started = await manager.startLogin(
    undefined,
    5000,
    (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 20))),
  );
  assert.match(started.url ?? "", /react\/#\/login\/parent/);
  assert.equal(opened.length, 1, "the browser opener still runs");
  // end the background login so its callback server does not keep the process alive
  await fetch("http://127.0.0.1:43555/callback?error=cancelled");
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(pending.read()?.state, "failed");
  assert.match(pending.read()?.error ?? "", /cancelled/);
});
