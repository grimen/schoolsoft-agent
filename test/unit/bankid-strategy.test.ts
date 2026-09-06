/**
 * BankIdBrowserStrategy end to end with everything external injected:
 * the browser (simulated callback hit), SchoolSoft's token endpoint, the
 * Eva parent profile, and the cookie exchange. Asserts the exact request
 * sequence that was verified live, so a regression in any hop shows up
 * without a BankID round.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { BankIdBrowserStrategy } from "../../src/providers/schoolsoft/auth/bankid-browser.js";
import { SchoolsoftSession } from "../../src/providers/schoolsoft/session.js";

function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "RS256" })}.${b64(payload)}.sig`;
}

const PARENT = {
  userId: 21,
  firstName: "Förälder",
  lastName: "Test",
  children: [
    {
      studentId: 100,
      firstName: "Ett",
      lastName: "Test",
      schools: [{ orgId: 20, name: "Skolan", className: "4B" }],
    },
    {
      studentId: 101,
      firstName: "Två",
      lastName: "Test",
      schools: [{ orgId: 20, name: "Skolan", className: "1A" }],
    },
  ],
};

function fakeSchoolsoft() {
  const log: { url: string; headers: Record<string, string> }[] = [];
  const fetchImpl = async (
    url: string,
    _school: string,
    options: { headers?: Record<string, string> },
  ) => {
    log.push({ url, headers: options.headers ?? {} });
    const path = url.replace("https://sms.schoolsoft.se/taby", "");
    if (path.startsWith("/rest-api/login/token")) {
      const grant = /grantType=(\w+)/.exec(path)?.[1];
      return {
        status: 200,
        data: {
          access_token: jwt({ user_type: "PARENT", client_id: "vApp", exp: 9_999_999_999 }),
          refresh_token: grant === "code" ? "R1" : "R2",
        },
        headers: {},
        setCookies: [],
      };
    }
    if (path === "/eva/api/v1/parent")
      return { status: 200, data: PARENT, headers: {}, setCookies: [] };
    if (path === "/eva-apps/auth/login/parent") {
      return {
        status: 303,
        data: "",
        headers: {},
        setCookies: [
          `JSESSIONID=js-${options.headers?.childInFocus}; Path=/`,
          "hash=h; Path=/",
          "usertype=2; Path=/",
        ],
      };
    }
    return { status: 404, data: null, headers: {}, setCookies: [] };
  };
  return { fetchImpl, log };
}

let port = 43300;
function strategyWithFakes(
  prev = { log: [] as { url: string; headers: Record<string, string> }[] },
) {
  const { fetchImpl, log } = fakeSchoolsoft();
  prev.log = log;
  const strategy = new BankIdBrowserStrategy({
    fetchImpl,
    callbackPort: port++,
    openBrowser: (authUrl) => {
      const state = /[?&]state=([^&]+)/.exec(authUrl)![1];
      const redirect = decodeURIComponent(/redirect_uri=([^&]+)/.exec(authUrl)![1]);
      void fetch(`${redirect}?code=CODE&state=${state}`);
    },
  });
  return { strategy, log };
}

test("login: code → token (vApp) → parent profile → cookies bound to first child", async () => {
  const { strategy, log } = strategyWithFakes();
  const client = new SchoolsoftSession("taby");
  const info = await strategy.login(client);

  assert.equal(info.name, "Förälder Test");
  assert.equal(info.schoolName, "Skolan");
  assert.deepEqual(info.children, [
    { studentId: 100, firstName: "Ett" },
    { studentId: 101, firstName: "Två" },
  ]);
  assert.equal(client.client.accessToken?.split(".").length, 3);
  assert.equal(client.client.refreshToken, "R1");
  assert.equal(client.client.cookieHeader, "JSESSIONID=js-100; hash=h; usertype=2");
  assert.equal(strategy.context?.childInFocus, 100);

  const paths = log.map((l) => l.url.replace("https://sms.schoolsoft.se/taby", "").split("?")[0]);
  assert.deepEqual(paths, [
    "/rest-api/login/token",
    "/eva/api/v1/parent",
    "/eva-apps/auth/login/parent",
  ]);
  assert.match(log[0].url, /clientId=vApp&grantType=code&code=CODE/);
  assert.equal(log[2].headers.userId, "21");
  assert.equal(log[2].headers.orgId, "20");
});

test("restore: expired token refreshes with vApp and re-binds the remembered child", async () => {
  const { strategy, log } = strategyWithFakes();
  const client = new SchoolsoftSession("taby");
  await strategy.restore(client, {
    school: "taby",
    data: { accessToken: "old", refreshToken: "R1", accessTokenExpiresAt: 1 }, // long expired
    guardian: { userId: 21, parentName: "x", children: PARENT.children, childInFocus: 101 },
    savedAt: 0,
    authMethod: "bankid-browser",
  });
  assert.match(log[0].url, /clientId=vApp&grantType=refresh_token&refreshToken=R1/);
  assert.equal(client.client.refreshToken, "R2", "rotated refresh token adopted");
  assert.equal(client.client.cookieHeader, "JSESSIONID=js-101; hash=h; usertype=2");
  assert.equal(strategy.context?.childInFocus, 101);
});

test("focusChild re-exchanges cookies for the other child and rejects unknown ids", async () => {
  const { strategy, log } = strategyWithFakes();
  const client = new SchoolsoftSession("taby");
  await strategy.login(client);
  await strategy.focusChild(client, 101);
  assert.equal(client.client.cookieHeader, "JSESSIONID=js-101; hash=h; usertype=2");
  assert.equal(strategy.context?.childInFocus, 101);
  assert.equal(log.filter((l) => l.url.includes("/eva-apps/auth/login/parent")).length, 2);
  await assert.rejects(strategy.focusChild(client, 555), /Unknown child id 555/);
});

test("restore: unknown expiry refreshes up front", async () => {
  const { strategy, log } = strategyWithFakes();
  const client = new SchoolsoftSession("taby");
  await strategy.restore(client, {
    school: "taby",
    data: { accessToken: "old", refreshToken: "R1" },
    guardian: { userId: 21, parentName: "x", children: PARENT.children, childInFocus: 100 },
    savedAt: 0,
    authMethod: "bankid-browser",
  });
  assert.match(log[0].url, /grantType=refresh_token/);
  assert.equal(client.client.cookieHeader, "JSESSIONID=js-100; hash=h; usertype=2");
});

test("restore: a 401 on the profile call triggers one refresh-and-retry", async () => {
  const { fetchImpl: inner, log } = fakeSchoolsoft();
  let parentCalls = 0;
  const fetchImpl = async (
    url: string,
    school: string,
    options: { headers?: Record<string, string> },
  ) => {
    if (url.endsWith("/eva/api/v1/parent") && parentCalls++ === 0) {
      return { status: 401, data: null, headers: {}, setCookies: [] };
    }
    return inner(url, school, options);
  };
  const strategy = new BankIdBrowserStrategy({ fetchImpl });
  const client = new SchoolsoftSession("taby");
  await strategy.restore(client, {
    school: "taby",
    data: { accessToken: "stale", refreshToken: "R1", accessTokenExpiresAt: 9_999_999_999 }, // looks valid, but server says 401
    guardian: { userId: 21, parentName: "x", children: PARENT.children, childInFocus: 101 },
    savedAt: 0,
    authMethod: "bankid-browser",
  });
  assert.equal(parentCalls, 2);
  assert.equal(log.filter((l) => l.url.includes("grantType=refresh_token")).length, 1);
  assert.equal(client.client.refreshToken, "R2");
  assert.equal(
    client.client.cookieHeader,
    "JSESSIONID=js-101; hash=h; usertype=2",
    "remembered child re-bound after the retry",
  );
});

test("edge cases: tokens without refresh/expiry, restore guards, no children, child without school", async () => {
  const { fetchImpl: inner } = fakeSchoolsoft();
  const variant = (o: { tokenData?: unknown; parent?: unknown; parentStatus?: number }) => {
    const fetchImpl = async (
      url: string,
      school: string,
      options: { headers?: Record<string, string> },
    ) => {
      const path = url.replace("https://sms.schoolsoft.se/taby", "");
      if (o.tokenData !== undefined && path.startsWith("/rest-api/login/token"))
        return { status: 200, data: o.tokenData, headers: {}, setCookies: [] };
      if (path === "/eva/api/v1/parent" && (o.parent !== undefined || o.parentStatus !== undefined))
        return {
          status: o.parentStatus ?? 200,
          data: o.parent ?? null,
          headers: {},
          setCookies: [],
        };
      return inner(url, school, options);
    };
    return new BankIdBrowserStrategy({
      fetchImpl,
      callbackPort: port++,
      openBrowser: (authUrl) => {
        const state = /[?&]state=([^&]+)/.exec(authUrl)![1];
        const redirect = decodeURIComponent(/redirect_uri=([^&]+)/.exec(authUrl)![1]);
        void fetch(`${redirect}?code=CODE&state=${state}`);
      },
    });
  };
  const saved = (extra: Record<string, unknown>) => ({
    school: "taby",
    savedAt: 0,
    authMethod: "bankid-browser",
    ...extra,
  });

  // login with an opaque token: no refresh token, no expiry
  const opaque = variant({ tokenData: { access_token: "opaque" } });
  const c1 = new SchoolsoftSession("taby");
  await opaque.login(c1);
  assert.equal(c1.client.refreshToken, null);

  // restore guards
  await assert.rejects(
    new BankIdBrowserStrategy({ fetchImpl: inner }).restore(
      new SchoolsoftSession("taby"),
      saved({ data: {} }) as never,
    ),
    /no access token/,
  );
  await assert.rejects(
    new BankIdBrowserStrategy({ fetchImpl: inner }).restore(
      new SchoolsoftSession("taby"),
      saved({ data: { accessToken: "old", accessTokenExpiresAt: 1 } }) as never,
    ),
    /no refresh token saved/,
  );
  // profile 500: not a 401, rethrown without refresh
  await assert.rejects(
    variant({ parentStatus: 500 }).restore(
      new SchoolsoftSession("taby"),
      saved({
        data: { accessToken: "t", refreshToken: "R1", accessTokenExpiresAt: 9_999_999_999 },
      }) as never,
    ),
    /HTTP 500/,
  );
  // profile 401 but no refresh token: rethrown
  const c2 = new SchoolsoftSession("taby");
  await assert.rejects(
    variant({ parentStatus: 401 }).restore(
      c2,
      saved({ data: { accessToken: "t", accessTokenExpiresAt: 9_999_999_999 } }) as never,
    ),
    /HTTP 401/,
  );
  // refresh response without rotation keeps the old refresh token
  const keep = variant({ tokenData: { access_token: "fresh" } });
  const c3 = new SchoolsoftSession("taby");
  await keep.restore(
    c3,
    saved({ data: { accessToken: "old", refreshToken: "R1", accessTokenExpiresAt: 1 } }) as never,
  );
  assert.equal(c3.client.refreshToken, "R1");
  // focusChild before any login
  await assert.rejects(
    new BankIdBrowserStrategy({ fetchImpl: inner }).focusChild(new SchoolsoftSession("taby"), 100),
    /log in first/,
  );
  // no children
  await assert.rejects(
    variant({ parent: { ...PARENT, children: [] } }).login(new SchoolsoftSession("taby")),
    /no children/,
  );
  // child without school: schoolName null (and the exchange has no orgId)
  const noSchool = variant({
    parent: { ...PARENT, children: [{ ...PARENT.children[0], schools: [] }] },
  });
  await assert.rejects(noSchool.login(new SchoolsoftSession("taby")), /has no school/);
});
