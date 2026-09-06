/**
 * webLogin with a fake playwright: opens the tenant root headed, polls until a
 * portal URL appears, keeps only tenant cookies, times out otherwise; plus
 * SessionManager persistence of the web session.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { webLogin, isPortalUrl } from "../../src/core/browser/web-login.js";
import type { PlaywrightLike } from "../../src/core/browser/playwright.js";
import { SessionManager, MemorySessionStore } from "../../src/core/index.js";
import { FakeAuth, fakeSchoolsoftClient } from "../helpers/fakes.js";

function fakePw(
  urls: string[],
  cookies: { name: string; value: string; domain: string; path: string; expires: number }[],
) {
  const state = { launched: [] as { headless: boolean }[], closed: 0, gotos: [] as string[] };
  let i = 0;
  const page = {
    goto: async (u: string) => {
      state.gotos.push(u);
    },
    url: () => urls[Math.min(i++, urls.length - 1)],
  };
  const extra = {
    url: () => "https://sms.schoolsoft.se/taby/jsp/student/right_student_startpage.jsp",
  };
  const context = {
    newPage: async () => page,
    cookies: async () => cookies,
    pages: () => (urls[0] === "POPUP" ? [page, extra] : [page]),
  };
  const browser = {
    newContext: async () => context,
    close: async () => {
      state.closed++;
    },
  };
  const pw: PlaywrightLike = {
    chromium: {
      launch: async (o) => {
        state.launched.push(o);
        return browser as never;
      },
      executablePath: () => "/fake/chromium",
      connectOverCDP: async () => browser as never,
    },
  };
  return { pw, state };
}

test("isPortalUrl accepts parent pages and rejects login steps", () => {
  const o = "https://sms.schoolsoft.se";
  assert.ok(isPortalUrl(`${o}/taby/jsp/student/right_student_startpage.jsp`, o, "taby"));
  assert.ok(isPortalUrl(`${o}/taby/react/#/parent/calendar`, o, "taby"));
  assert.ok(!isPortalUrl(`${o}/taby/jsp/Login.jsp`, o, "taby"));
  assert.ok(!isPortalUrl(`${o}/taby/samlLogin.jsp?usertype=parent`, o, "taby"));
  assert.ok(!isPortalUrl("https://etjanst.taby.se/wa/auth/saml/", o, "taby"));
  assert.ok(!isPortalUrl(`${o}/other/jsp/student/x.jsp`, o, "taby"));
});

test("webLogin opens the tenant root in a headed window, waits for the portal, keeps tenant cookies only", async () => {
  const { pw, state } = fakePw(
    [
      "https://sms.schoolsoft.se/taby/jsp/Login.jsp",
      "https://etjanst.taby.se/wa/auth/saml/",
      "https://sms.schoolsoft.se/taby/jsp/student/right_student_startpage.jsp?x=1",
    ],
    [
      { name: "JSESSIONID", value: "web", domain: "sms.schoolsoft.se", path: "/", expires: -1 },
      { name: "hash", value: "h", domain: ".sms.schoolsoft.se", path: "/", expires: 1_900_000_000 },
      { name: "_shib", value: "x", domain: "etjanst.taby.se", path: "/", expires: -1 },
    ],
  );
  const opened: string[] = [];
  const web = await webLogin({
    school: "taby",
    loader: async () => pw,
    pollMs: 1,
    onOpen: (u) => opened.push(u),
  });
  assert.deepEqual(state.launched, [{ headless: false }]);
  assert.deepEqual(opened, ["https://sms.schoolsoft.se/taby/"]);
  assert.deepEqual(
    web.cookies.map((c) => c.name),
    ["JSESSIONID", "hash"],
  );
  assert.equal(
    web.landedOn,
    "https://sms.schoolsoft.se/taby/jsp/student/right_student_startpage.jsp",
  );
  assert.equal(state.closed, 1, "window closed afterwards");
});

test("webLogin times out without a portal page and closes the browser", async () => {
  const { pw, state } = fakePw(["https://sms.schoolsoft.se/taby/jsp/Login.jsp"], []);
  await assert.rejects(
    webLogin({ school: "taby", loader: async () => pw, pollMs: 1, timeoutMs: 20 }),
    /timed out/,
  );
  assert.equal(state.closed, 1);
});

test("SessionManager stores, exposes, and clears the web session next to the app session", async () => {
  const store = new MemorySessionStore();
  const web = {
    cookies: [{ name: "JSESSIONID", value: "w", domain: "sms.schoolsoft.se", path: "/" }],
    savedAt: 1,
    landedOn: "x",
  };
  const manager = new SessionManager({
    school: "testskola",
    store,
    strategies: [new FakeAuth()],
    clientFactory: () => fakeSchoolsoftClient(),
    webLogin: async () => web,
  });
  await manager.login();
  assert.equal(manager.getWebSession(), null);
  const r = await manager.webLogin();
  assert.equal(r.status, "web_logged_in");
  assert.equal(store.load()?.web?.cookies[0].value, "w");
  // a later persist (e.g. token refresh) must keep it
  await manager.login();
  assert.equal(store.load()?.web?.cookies[0].value, "w");
  // a fresh manager reads it back
  const again = new SessionManager({
    school: "testskola",
    store,
    strategies: [new FakeAuth()],
    clientFactory: () => fakeSchoolsoftClient(),
  });
  assert.equal(again.getWebSession()?.cookies.length, 1);
  again.clearWebSession();
  assert.equal(store.load()?.web, undefined);
  await assert.rejects(again.webLogin(), /not available/);
});

test("webLogin also accepts the portal appearing in another tab or popup", async () => {
  const { pw, state } = fakePw(
    ["POPUP"],
    [{ name: "JSESSIONID", value: "web", domain: "sms.schoolsoft.se", path: "/", expires: -1 }],
  );
  const web = await webLogin({ school: "taby", loader: async () => pw, pollMs: 1, timeoutMs: 200 });
  assert.equal(
    web.landedOn,
    "https://sms.schoolsoft.se/taby/jsp/student/right_student_startpage.jsp",
  );
  assert.equal(state.closed, 1);
});

test("cdp engine connects instead of launching; default poll interval is used when omitted", async () => {
  const { pw, state } = fakePw(
    ["https://sms.schoolsoft.se/taby/jsp/student/right_student_startpage.jsp"],
    [{ name: "JSESSIONID", value: "w", domain: "sms.schoolsoft.se", path: "/", expires: -1 }],
  );
  const session = await webLogin({
    school: "taby",
    engine: { kind: "cdp", endpoint: "ws://obscura" },
    loader: async () => pw,
  });
  assert.equal(session.cookies.length, 1);
  assert.equal(state.launched.length, 0, "no launch with a CDP engine");
});
