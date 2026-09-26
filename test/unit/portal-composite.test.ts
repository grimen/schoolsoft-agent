import { test } from "node:test";
import assert from "node:assert/strict";
import { createCompositePortal, providerOf } from "../../src/core/portal/composite.js";
import {
  CAPABILITIES,
  BrowserRequiredError,
  CapabilityNotSupportedError,
  type Portal,
  type Capability,
} from "../../src/core/portal/types.js";
import {
  ROUTING,
  BROWSER_CAPABILITIES,
  API_CAPABILITIES,
} from "../../src/providers/schoolsoft/routing.js";

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

test("SchoolSoft's routing lists every Portal capability with a non-empty provider list", () => {
  const caps = Object.keys(ROUTING) as Capability[];
  assert.equal(caps.length, 22);
  assert.deepEqual(
    [...caps].sort(),
    [...CAPABILITIES].sort(),
    "routing and the capability list agree",
  );
  for (const c of caps) assert.ok(ROUTING[c].length > 0, c);
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
  assert.equal(API_CAPABILITIES.length, 14);
});

test("api capabilities route to the api part with their arguments", async () => {
  const api = recorder();
  const portal = createCompositePortal({ routing: ROUTING, api: api.part as never });
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
  const portal = createCompositePortal({
    routing: ROUTING,
    api: api.part as never,
    browser: browser.part as never,
  });
  assert.equal(await portal.getContacts(), "getContacts-result");
  assert.equal(browser.calls.length, 1);
  assert.equal(api.calls.length, 0, "browser capability never touches the api part");
});

test("browser capabilities without a browser fail with the install hint and the reason", async () => {
  const api = recorder();
  const portal = createCompositePortal({
    routing: ROUTING,
    api: api.part as never,
    browser: null,
    browserUnavailableReason: "playwright is not installed",
  });
  await assert.rejects(portal.getFiles(), (e: unknown) => {
    assert.ok(e instanceof BrowserRequiredError);
    assert.match(e.message, /headless browser/);
    assert.match(e.message, /playwright is not installed/);
    assert.match(e.message, /getFiles/);
    return true;
  });
  assert.equal(await portal.getSession(), "getSession-result", "api still works");
});

test("providerOf reports the static routing; a capability outside a provider's routing is refused by name", async () => {
  assert.equal(providerOf(ROUTING, "getScheduleWeek"), "api");
  assert.equal(providerOf(ROUTING, "getBookings"), "browser");
  assert.equal(providerOf({}, "getBookings"), null);
  const partial = createCompositePortal({
    routing: { getScheduleWeek: ["api"] },
    providerId: "minimal",
    api: recorder().part as never,
  });
  assert.equal(await partial.getScheduleWeek(1), "getScheduleWeek-result");
  await assert.rejects(partial.getGrades(), CapabilityNotSupportedError);
  await assert.rejects(partial.getGrades(), /"minimal"/);
  const anonymous = createCompositePortal({ routing: {}, api: recorder().part as never });
  await assert.rejects(anonymous.getGrades(), /"unknown"/);
});

test("Portal type and CAPABILITIES agree (compile-time contract exercised at runtime)", () => {
  const portal = createCompositePortal({
    routing: ROUTING,
    api: recorder().part as never,
    browser: recorder().part as never,
  });
  const keys = Object.keys(portal).sort();
  assert.deepEqual(keys, ([...CAPABILITIES] as (keyof Portal)[]).sort());
  // every Portal method is listed exactly once
  const check: Record<Capability, true> = Object.fromEntries(
    CAPABILITIES.map((c) => [c, true]),
  ) as never;
  assert.equal(Object.keys(check).length, CAPABILITIES.length);
});

test("BrowserRequiredError without a reason has no parenthetical", async () => {
  const e = new BrowserRequiredError("getContacts");
  assert.match(e.message, /headless browser\.$/);
  assert.match(new BrowserRequiredError("getContacts", "tests").message, /\(tests\)\.$/);
});
