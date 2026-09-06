import { test } from "node:test";
import assert from "node:assert/strict";
import { createCompositePortal, providerOf } from "../../src/core/portal/composite.js";
import {
  PROVIDERS,
  BrowserRequiredError,
  BROWSER_CAPABILITIES,
  API_CAPABILITIES,
  type Portal,
  type Capability,
} from "../../src/core/portal/types.js";

function recorder() {
  const calls: { name: string; args: unknown[] }[] = [];
  const part = new Proxy(
    {},
    {
      get:
        (_t, name: string) =>
        (...args: unknown[]) => {
          calls.push({ name, args });
          return Promise.resolve(`${name}-result`);
        },
    },
  );
  return { calls, part };
}

test("PROVIDERS lists every Portal capability with a non-empty provider list", () => {
  const caps = Object.keys(PROVIDERS) as Capability[];
  assert.equal(caps.length, 21);
  for (const c of caps) assert.ok(PROVIDERS[c].length > 0, c);
  assert.deepEqual(BROWSER_CAPABILITIES.sort(), [
    "getAssessmentCriteria",
    "getAttendanceReport",
    "getBookings",
    "getContacts",
    "getFiles",
    "getGrades",
    "getStudentDocuments",
    "getUnreportedAbsence",
  ]);
  assert.equal(API_CAPABILITIES.length, 13);
});

test("api capabilities route to the api part with their arguments", async () => {
  const api = recorder();
  const portal = createCompositePortal({ api: api.part as never });
  assert.equal(await portal.getScheduleWeek(37), "getScheduleWeek-result");
  assert.equal(await portal.getNews(1, 2, 3), "getNews-result");
  assert.deepEqual(api.calls, [
    { name: "getScheduleWeek", args: [37] },
    { name: "getNews", args: [1, 2, 3] },
  ]);
});

test("browser capabilities route to the browser part when present", async () => {
  const api = recorder();
  const browser = recorder();
  const portal = createCompositePortal({ api: api.part as never, browser: browser.part as never });
  assert.equal(await portal.getContacts(), "getContacts-result");
  assert.equal(browser.calls.length, 1);
  assert.equal(api.calls.length, 0, "browser capability never touches the api part");
});

test("browser capabilities without a browser fail with the install hint and the reason", async () => {
  const api = recorder();
  const portal = createCompositePortal({
    api: api.part as never,
    browser: null,
    browserUnavailableReason: "playwright is not installed",
  });
  await assert.rejects(portal.getFiles(), (e: unknown) => {
    assert.ok(e instanceof BrowserRequiredError);
    assert.match(e.message, /schoolsoft-agent browser install/);
    assert.match(e.message, /playwright is not installed/);
    assert.match(e.message, /getFiles/);
    return true;
  });
  assert.equal(await portal.getSession(), "getSession-result", "api still works");
});

test("providerOf reports the static routing", () => {
  assert.equal(providerOf("getScheduleWeek"), "api");
  assert.equal(providerOf("getBookings"), "browser");
});

test("Portal type and PROVIDERS agree (compile-time contract exercised at runtime)", () => {
  const portal = createCompositePortal({
    api: recorder().part as never,
    browser: recorder().part as never,
  });
  const keys = Object.keys(portal).sort();
  assert.deepEqual(keys, (Object.keys(PROVIDERS) as (keyof Portal)[]).sort());
});
