/**
 * The reference page against the real connector over HTTP: the real OAuth provider,
 * runtime and provider, the fake portal from the connector smoke at the fetch seam, and
 * the page's own module (app.ts) as the browser, with its fetch sent to the connector.
 * The owner's clicks on the consent page are made the way the owner-flow tests make them.
 */
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { test, type TestContext } from "node:test";
import {
  MemoryPendingLoginStore,
  MemorySessionHistoryStore,
  MemorySessionStore,
  resolveConfig,
} from "../../src/core/index.js";
import { CountingBudget } from "../helpers/budget.js";
import type { ConnectorConfig } from "../../src/http/config.js";
import { ConnectorOAuthProvider, type OAuthState } from "../../src/http/oauth.js";
import { CONNECTOR_OPERATIONS, ConnectorRuntime } from "../../src/http/runtime.js";
import { createConnectorApp } from "../../src/http/server.js";
import { ReferencePage, weekOf, type Env, type FetchInit } from "../../src/http/reference/app.js";
import {
  FAKE_GUARDIAN,
  FAKE_LUNCH_DISH,
  FAKE_UPSTREAM_CODE,
  fakeUpstream,
} from "../packaging/connector-smoke/fake-upstream.mjs";

const origin = "https://connector.example";
const PAGE = origin + "/reference/";
const [ALVA, BO] = FAKE_GUARDIAN.children;
/** The fake portal's lessons are on Monday 7 September 2026 (ISO week 37). */
const NOW = new Date("2026-09-09T10:00:00Z");
const STRICT =
  "default-src 'none'; form-action 'self' https://claude.ai https://chatgpt.com; frame-ancestors 'none'; base-uri 'none'";
type UpstreamReply = { status: number; data: unknown; headers: object; setCookies: string[] };

interface Reply {
  status: number;
  headers: Headers;
  text: string;
}

async function fixture(t: TestContext) {
  const upstream = fakeUpstream();
  let intercept: ((path: string) => UpstreamReply | undefined) | undefined;
  const config: ConnectorConfig = {
    publicUrl: origin,
    adminPassword: "synthetic-admin-password-for-the-page-test",
    storageKey: Buffer.alloc(32, 1),
    stateDir: "/unused",
    port: 3000,
    school: "synthetic-fixture",
    proxyHops: 0,
  };
  let state: OAuthState | undefined;
  const oauth = new ConnectorOAuthProvider({
    resourceUrl: origin + "/mcp",
    scopes: [...CONNECTOR_OPERATIONS],
    ownCallbacks: [PAGE],
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
      budget: new CountingBudget(),
      fetchImpl: async (url: string, school: string, request?: object) => {
        const path = new URL(url).pathname.replace(/^\/[^/]+/, "");
        return intercept?.(path) ?? upstream.fetchImpl(url, school, request);
      },
    },
  });
  const app = createConnectorApp({ config, oauth, runtime });
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
            resolve({ status: res.statusCode!, headers, text: Buffer.concat(chunks).toString() });
          });
        },
      );
      req.on("error", reject);
      req.end(init.body);
    });

  // The connector signs in to the (fake) portal; the parent's BankID step is simulated.
  const { url } = await runtime.beginLogin();
  assert.equal(
    runtime.callback(decodeURIComponent(/[?&#]state=([^&#]+)/.exec(url)![1]), FAKE_UPSTREAM_CODE),
    true,
  );
  for (let attempt = 0; !(await runtime.status()).authenticated; attempt++) {
    assert.ok(attempt < 50, "the fake sign-in did not complete");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  /** The parent's browser tab: one sessionStorage, the page's module, its fetch to the connector. */
  function tab() {
    const storage = new Map<string, string>();
    const calls: string[] = [];
    let listeners = new Map<string, (event: { target: unknown }) => unknown>();
    let assigned: string | undefined;
    const root = {
      innerHTML: "",
      addEventListener: (type: string, fn: (event: { target: unknown }) => unknown) =>
        void listeners.set(type, fn),
    };
    const env = (href: string): Env => ({
      origin,
      href,
      assign: (target) => {
        assigned = target;
      },
      replaceUrl: () => {},
      storage: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => void storage.set(key, value),
        removeItem: (key) => void storage.delete(key),
      },
      fetch: async (target: string, init: FetchInit = {}) => {
        const address = new URL(target, origin);
        assert.equal(address.origin, origin, "the page only talks to its own origin");
        const method = init.method ?? "GET";
        calls.push(`${method} ${address.pathname}${address.search}`);
        const reply = await request(address.pathname + address.search, {
          method,
          // A browser sends Origin on a same-origin POST, not on a GET.
          headers: { ...init.headers, ...(method === "GET" ? {} : { Origin: origin }) },
          body: init.body,
        });
        return {
          status: reply.status,
          headers: reply.headers,
          json: async () => JSON.parse(reply.text),
        };
      },
      random: (bytes) => webcrypto.getRandomValues(new Uint8Array(bytes)),
      sha256: (data) => webcrypto.subtle.digest("SHA-256", new Uint8Array(data)),
      now: () => NOW,
      root,
    });
    /** A page load at `href`: a fresh module instance, the same tab storage. */
    const load = async (href = PAGE) => {
      listeners = new Map();
      assigned = undefined;
      await new ReferencePage(env(href)).start();
    };
    const target = (action: string, value?: string) => ({
      closest: () => ({ getAttribute: () => action }),
      getAttribute: () => action,
      value,
    });
    return {
      load,
      calls,
      storage,
      html: () => root.innerHTML,
      assigned: () => assigned,
      click: (action: string) =>
        listeners.get("click")!({ target: target(action) }) as Promise<void>,
      change: (value: string) =>
        listeners.get("change")!({ target: target("child", value) }) as Promise<void>,
    };
  }

  /** The owner's side of the consent: sign in to the dashboard, choose, approve. */
  async function consent(authorizeUrl: string, children: number[], scopes?: string[]) {
    const authorize = new URL(authorizeUrl);
    assert.equal(authorize.origin, origin);
    const started = await request(authorize.pathname + authorize.search);
    assert.equal(started.status, 302, started.text);
    const consentPath = started.headers.get("location")!;
    const requestId = new URL(consentPath, origin).searchParams.get("request")!;
    const login = await request("/owner/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: origin },
      body: new URLSearchParams({ password: config.adminPassword, request: requestId }).toString(),
    });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const page = await request(consentPath, { headers: { Cookie: cookie } });
    assert.equal(page.status, 200);
    const csrf = /name="csrf" value="([^"]+)"/.exec(page.text)![1];
    const offered = [...page.text.matchAll(/name="scopes" value="([^"]+)"/g)].map((m) => m[1]);
    const approved = await request("/owner/approve", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: origin,
        Cookie: cookie,
      },
      body: new URLSearchParams([
        ["csrf", csrf],
        ["request", requestId],
        ...children.map((child) => ["children", String(child)]),
        ...(scopes ?? offered).map((scope) => ["scopes", scope]),
      ]).toString(),
    });
    assert.equal(approved.status, 302);
    return { consentPage: page.text, back: approved.headers.get("location")!, cookie, csrf };
  }

  /** A tab connected through the page's own button and the owner's consent. */
  async function connected(children: number[], scopes?: string[]) {
    const browser = tab();
    await browser.load();
    await browser.click("connect");
    const owner = await consent(browser.assigned()!, children, scopes);
    await browser.load(owner.back);
    return { browser, owner };
  }

  return {
    oauth,
    upstream,
    request,
    tab,
    consent,
    connected,
    intercept: (fn: typeof intercept) => {
      intercept = fn;
    },
  };
}

const sha = (text: string) => `'sha256-${createHash("sha256").update(text).digest("base64")}'`;

test("the page is served same-origin with a policy scoped to its own inline code, and no data", async (t) => {
  const f = await fixture(t);
  for (const path of ["/reference/", "/reference/?code=x&state=y"]) {
    const page = await f.request(path);
    assert.equal(page.status, 200, path);
    assert.equal(page.headers.get("content-type"), "text/html; charset=utf-8");
    const script = /<script type="module">([\s\S]*)<\/script>/.exec(page.text)![1];
    const style = /<style>([\s\S]*)<\/style>/.exec(page.text)![1];
    assert.equal(
      page.headers.get("content-security-policy"),
      `default-src 'none'; script-src ${sha(script)}; style-src ${sha(style)}; connect-src 'self'; img-src 'none'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'`,
    );
    assert.equal(page.headers.get("cache-control"), "no-store");
    assert.equal(page.headers.get("x-content-type-options"), "nosniff");
    assert.equal(page.headers.get("referrer-policy"), "no-referrer");
    assert.equal(page.headers.get("strict-transport-security"), "max-age=31536000");
    assert.equal(page.headers.get("access-control-allow-origin"), null);
    assert.match(script, /boot\(globalThis\);\n$/);
    assert.doesNotMatch(page.text, /Synthetic|servedForChild/, "the page itself carries no data");
  }
  const bare = await f.request("/reference");
  assert.equal(bare.status, 301);
  assert.equal(bare.headers.get("location"), "/reference/");
  for (const [method, path] of [
    ["POST", "/reference/"],
    ["GET", "/reference/app.js"],
    ["GET", "/reference/x/"],
  ]) {
    const other = await f.request(path, { method });
    assert.equal(other.status, 404, `${method} ${path}`);
    assert.equal(other.headers.get("content-security-policy"), STRICT);
  }
  assert.equal(
    (await f.request("/reference/", { headers: { Host: "rebound.example" } })).status,
    421,
  );
  // The owner pages keep the strict policy, and link the page.
  const login = await f.request("/owner/login");
  assert.equal(login.headers.get("content-security-policy"), STRICT);
});

test("a parent connects the page through the ordinary consent and sees one child's week", async (t) => {
  const f = await fixture(t);
  const browser = f.tab();
  await browser.load();
  assert.match(browser.html(), /data-action="connect"/);
  await browser.click("connect");
  // Discovery came from the API's own 401 challenge; nothing was readable without a token.
  assert.deepEqual(browser.calls, [
    "GET /api/v1/session",
    "GET /.well-known/oauth-protected-resource/mcp",
    "GET /.well-known/oauth-authorization-server",
    "POST /register",
  ]);
  const owner = await f.consent(browser.assigned()!, [ALVA.studentId]);
  assert.match(owner.consentPage, /Return address: https:\/\/connector\.example\/reference\//);
  assert.match(
    owner.consentPage,
    /shown in this browser on your connector's reference page; it is not sent to an AI provider/,
  );
  const back = new URL(owner.back);
  assert.equal(back.origin + back.pathname, PAGE);
  assert.ok(back.searchParams.get("code") && back.searchParams.get("state"));
  // The browser loads the callback address: the same public page.
  assert.equal((await f.request(back.pathname + back.search)).status, 200);
  const grant = f.oauth.listGrants().find((g) => g.clientName === "Reference page")!;
  assert.deepEqual(grant.childIds, [ALVA.studentId]);
  assert.deepEqual(grant.scopes, ["get_schedule", "get_lunch_menu", "get_calendar"]);

  const before = browser.calls.length;
  await browser.load(owner.back);
  const week = weekOf("2026-09-09");
  assert.deepEqual(browser.calls.slice(before), [
    "POST /token",
    "GET /api/v1/session",
    `GET /api/v1/children/${ALVA.studentId}/schedule?week=37`,
    `GET /api/v1/children/${ALVA.studentId}/lunch-menu?week=37`,
    `GET /api/v1/children/${ALVA.studentId}/calendar?start_date=${week.days[0]}&end_date=${week.days[6]}`,
  ]);
  const html = browser.html();
  assert.match(html, /<h1>Week 37: Synthetic Alva<\/h1>/);
  assert.match(html, /<h2>Mon 7 Sep<\/h2><ul><li>08:00–09:00 Synthetic lesson<\/li>/);
  assert.match(
    html,
    /<h2>Tue 8 Sep<\/h2><ul><li class="event">All day Synthetic school event<\/li>/,
  );
  // The lunch menu's year is the ISO year nearest the connector's own clock.
  if (html.includes("Mon 7 Sep") && new Date().getUTCFullYear() === 2026)
    assert.match(html, new RegExp(`Lunch: ${FAKE_LUNCH_DISH}`));
  assert.doesNotMatch(html, /Synthetic Bo|<select|class="notice"/);
  // Nothing but the refresh token and the client survive in the tab's storage.
  assert.deepEqual(Object.keys(JSON.parse(browser.storage.get("schoolsoft-reference")!)), [
    "client",
    "refresh",
  ]);

  // A reload refreshes instead of asking for consent again.
  const reloadFrom = browser.calls.length;
  await browser.load();
  assert.equal(browser.calls[reloadFrom], "POST /token");
  assert.match(browser.html(), /Week 37: Synthetic Alva/);
});

test("with two children granted, the page shows one at a time and switching reads only the other", async (t) => {
  const f = await fixture(t);
  const { browser } = await f.connected([ALVA.studentId, BO.studentId]);
  assert.match(browser.html(), /Week 37: Synthetic Alva/);
  assert.match(browser.html(), /<select data-action="child">/);
  const before = browser.calls.length;
  await browser.change(String(BO.studentId));
  const reads = browser.calls.slice(before).filter((c) => c.includes("/children/"));
  assert.equal(reads.length, 3);
  assert.ok(
    reads.every((c) => c.includes(`/children/${BO.studentId}/`)),
    reads.join(),
  );
  assert.match(browser.html(), /<h1>Week 37: Synthetic Bo<\/h1>/);
  assert.match(browser.html(), /Synthetic lesson/);
  assert.doesNotMatch(browser.html(), /Week 37: Synthetic Alva/);
});

test("a scope the owner unticked is shown as not granted; the others render", async (t) => {
  const f = await fixture(t);
  const { browser } = await f.connected([ALVA.studentId], ["get_schedule"]);
  assert.match(browser.html(), /Synthetic lesson/);
  assert.match(browser.html(), /Lunch: not granted to this page/);
  assert.match(browser.html(), /School events: not granted to this page/);
  assert.ok(!browser.calls.some((c) => c.includes("/lunch-menu") || c.includes("/calendar")));
});

test("revoked on the dashboard, the page is refused and returns to the connect step", async (t) => {
  const f = await fixture(t);
  const { browser, owner } = await f.connected([ALVA.studentId]);
  const grant = f.oauth.listGrants()[0];
  const revoked = await f.request("/owner/revoke", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: origin,
      Cookie: owner.cookie,
    },
    body: new URLSearchParams({ csrf: owner.csrf, grant: grant.id }).toString(),
  });
  assert.equal(revoked.status, 302);
  await browser.click("reload");
  assert.match(browser.html(), /connection has ended/);
  assert.match(browser.html(), /data-action="connect"/);
  assert.doesNotMatch(browser.html(), /Synthetic/);
  assert.equal(JSON.parse(browser.storage.get("schoolsoft-reference")!).refresh, undefined);
});

test("a lost SchoolSoft session is a 409 with the dashboard link, then the signed-out notice", async (t) => {
  const f = await fixture(t);
  const { browser } = await f.connected([ALVA.studentId]);
  // The portal rejects the session and the silent re-login alike.
  f.intercept((path) =>
    path.includes("/lessons/week/") || path.includes("/login/token")
      ? { status: 401, data: null, headers: {}, setCookies: [] }
      : undefined,
  );
  await browser.click("reload");
  assert.match(
    browser.html(),
    /Lessons: [^<]*<a href="https:\/\/connector\.example\/owner">Open the owner dashboard<\/a>/,
  );
  assert.doesNotMatch(browser.html(), /Synthetic lesson/);
  f.intercept(undefined);
  await browser.click("reload");
  assert.match(browser.html(), /not signed in to SchoolSoft/);
  assert.match(browser.html(), /<a href="https:\/\/connector\.example\/owner">/);
});

test("disconnecting from the page withdraws its grant on the connector", async (t) => {
  const f = await fixture(t);
  const { browser } = await f.connected([ALVA.studentId]);
  assert.equal(f.oauth.listGrants().length, 1);
  await browser.click("disconnect");
  assert.equal(browser.calls.at(-1), "POST /revoke");
  assert.deepEqual(f.oauth.listGrants(), []);
  assert.match(browser.html(), /Disconnected/);
  assert.equal(browser.storage.size, 0);
});

test("the owner dashboard links the page", async (t) => {
  const f = await fixture(t);
  const { owner } = await f.connected([ALVA.studentId]);
  const dashboard = await f.request("/owner", { headers: { Cookie: owner.cookie } });
  assert.match(dashboard.text, /<a href="\/reference\/">Reference page<\/a>/);
  assert.match(dashboard.text, /Reference page: get_schedule, get_lunch_menu, get_calendar/);
});
