/**
 * Provider contract: the assertions every SchoolProvider must satisfy,
 * run against each registered provider with no network. A new vendor
 * passes this suite before it gets a PR. Vendor-specific behaviour is
 * tested in the provider's own unit tests; this is the shared shape.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BUDGET_BOUNDS,
  CAPABILITIES,
  resolveConfig,
  type SchoolProvider,
} from "../../src/core/index.js";
import { getProvider, providerIds } from "../../src/providers/index.js";
import { CountingBudget } from "../helpers/budget.js";

const defaults = { home: "/h", platform: "linux" as const, env: {} };

for (const id of providerIds) {
  const provider: SchoolProvider = getProvider(id);

  test(`[${id}] identity and routing: every routed capability is a real one, browser-only ones have no api entry`, () => {
    assert.equal(provider.id, id);
    assert.ok(provider.displayName.length > 0);
    for (const [cap, order] of Object.entries(provider.routing)) {
      assert.ok(CAPABILITIES.includes(cap as never), `${cap} is not a Portal capability`);
      assert.ok(order && order.length > 0, `${cap} has an empty provider list`);
      for (const p of order!) assert.ok(p === "api" || p === "browser", `${cap}: ${p}`);
    }
    for (const cap of provider.webSessionCapabilities) {
      assert.ok(provider.routing[cap], `web-session capability ${cap} must be routed`);
    }
  });

  test(`[${id}] pages: every page declares a path and anchors; example queries point at declared pages; fingerprints refer to declared pages`, () => {
    for (const [key, spec] of Object.entries(provider.pages)) {
      assert.ok(spec.path.startsWith("/"), `${key}.path`);
      assert.ok(spec.anchors.length > 0, `${key}.anchors`);
      assert.equal(typeof spec.web, "boolean", `${key}.web`);
      if (spec.exampleQuery)
        assert.ok(provider.pages[spec.exampleQuery.from], `${key}.exampleQuery.from`);
    }
    for (const key of Object.keys(provider.fingerprints)) {
      assert.ok(provider.pages[key], `fingerprint for undeclared page ${key}`);
      assert.match(provider.fingerprints[key]!.fingerprint, /^[0-9a-f]{8}$/);
    }
  });

  test(`[${id}] web login spec: a login URL on the origin, and it never counts as a portal page`, () => {
    const url = provider.webLogin.loginUrl("demo");
    assert.ok(url.startsWith(provider.webLogin.origin), url);
    assert.equal(
      provider.webLogin.isPortalUrl(url, "demo"),
      false,
      "the login entry is not the portal",
    );
    assert.equal(provider.webLogin.isPortalUrl("https://example.invalid/x", "demo"), false);
  });

  test(`[${id}] session: created per school, serialisable to a plain object, verifiable, with a cookie header or null`, async () => {
    const session = provider.createSession("demo", { budget: new CountingBudget() });
    assert.equal(session.school, "demo");
    const data = provider.serializeSession(session);
    assert.equal(typeof data, "object");
    assert.equal(JSON.parse(JSON.stringify(data)) instanceof Object, true, "JSON-safe");
    const header = session.cookieHeader();
    assert.ok(header === null || typeof header === "string");
    assert.equal(typeof session.verify, "function");
  });

  test(`[${id}] auth strategies: at least one, unique ids, and every one implements the whole contract`, () => {
    const config = resolveConfig(
      [{ provider: id, school: "demo", configDir: "/nowhere" }],
      defaults,
    );
    const strategies = provider.createAuthStrategies(config, {
      budget: new CountingBudget(),
      openBrowser: () => {},
    });
    assert.ok(strategies.length >= 1);
    assert.equal(new Set(strategies.map((s) => s.id)).size, strategies.length);
    for (const s of strategies) {
      for (const m of ["login", "restore", "focusChild"] as const) {
        assert.equal(typeof s[m], "function", `${s.id}.${m}`);
      }
    }
  });

  test(`[${id}] portals and directory are constructible without network and cover the routing`, () => {
    const budget = new CountingBudget();
    const session = provider.createSession("demo", { budget });
    const api = provider.createApiPortal(session, {
      budget,
      webCookieHeader: () => null,
      webChildTarget: () => null,
    });
    const browser = provider.createBrowserPortal(
      {
        withPage: async () => assert.fail("no navigation in the contract test"),
        close: async () => {},
      },
      { hasWebSession: () => false, syncWebChild: async () => {} },
    );
    for (const [cap, order] of Object.entries(provider.routing)) {
      const part = order![0] === "api" ? api : browser;
      assert.equal(
        typeof (part as Record<string, unknown>)[cap],
        "function",
        `${cap} not implemented by its ${order![0]} part`,
      );
    }
    assert.equal(typeof api.syncWebChild, "function");
    const dir = provider.createSchoolDirectory("/nowhere/schools.json", budget);
    assert.equal(typeof dir.find, "function");
  });

  test(`[${id}] request budget: default limits within the bounds; the reachability probe goes through the budget`, async () => {
    for (const key of ["perMinute", "burst", "maxInFlight"] as const) {
      const value = provider.requestBudget[key];
      assert.ok(
        Number.isInteger(value) &&
          value >= BUDGET_BOUNDS[key].min &&
          value <= BUDGET_BOUNDS[key].max,
        `${key} ${value}`,
      );
    }
    const budget = new CountingBudget();
    const urls: string[] = [];
    const status = await provider.probeReachability(budget, async (url: string) => {
      urls.push(url);
      return { status: 204 };
    });
    assert.equal(status, 204);
    assert.equal(budget.calls.length, 1, "the probe went through the budget");
    assert.ok(urls[0].startsWith(provider.webLogin.origin), urls[0]);
  });
}

test("unknown provider ids are refused with the available ones named", () => {
  assert.throws(
    () => getProvider("nope"),
    /Unknown school portal provider "nope"\. Available: schoolsoft/,
  );
});
