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
  assert.throws(() => resolveConfig([], defaults), /schoolsoft-agent configure/);
});

test("invalid user type and port are rejected", () => {
  assert.throws(
    () => resolveConfig([{ school: "s", userType: "alien" }], defaults),
    /Invalid userType/,
  );
  assert.throws(
    () => resolveConfig([{ school: "s", callbackPort: "abc" }], defaults),
    /Invalid callbackPort/,
  );
  assert.throws(
    () => resolveConfig([{ school: "s", callbackPort: 70000 }], defaults),
    /Invalid callbackPort/,
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
  await assert.rejects(api.getParent(), /No access token/);
  await assert.rejects(api.getScheduleWeek(1), /No session cookies/);
  await assert.rejects(manager.ensureSession(), /Not authenticated/);
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
    /Invalid browserEngine/,
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
    playwrightLoader: async () =>
      ({ chromium: { launch: async () => browser, connectOverCDP: async () => browser } }) as never,
  });
  const grades = await portal.getGrades();
  assert.equal(grades.title, "Betyg");
  await assert.rejects(
    portal.getGradePrognosis(),
    /HTTP 401|no network in tests/,
    "web cookie header built, request attempted",
  );
  assert.deepEqual(
    injected.map((c) => `${c.name}=${c.value}`),
    ["JSESSIONID=web-cookie"],
    "the web cookies, not the app cookie header, reach the browser for a gated page",
  );
  injected.length = 0;
  await assert.rejects(portal.getContacts(), /No session cookies|Login|login/);
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
  const portal = createPortal(manager, { browser: null, browserUnavailableReason: "tests" });
  await assert.rejects(portal.getContacts(), /browser install.*\(tests\)/);
  await assert.rejects(portal.getGradePrognosis(), /login --web/);
  const session = createBrowserSession(manager, {
    playwrightLoader: async () => {
      throw new Error("must not load");
    },
  });
  await assert.rejects(
    session.withPage(async () => 0, { web: true }),
    /login --web/,
  );
});
