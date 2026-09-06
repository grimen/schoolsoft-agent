/**
 * Unit tests for the guardian token → cookie exchange. HTTP is injected.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SchoolsoftClient } from "@elias4044/ssp-node";
import {
  exchangeTokenForCookies,
  type ExchangeFetch,
} from "../../src/core/auth/session-exchange.js";

function fakeClient() {
  const calls: unknown[][] = [];
  const client = {
    school: "testskola",
    accessToken: "ACCESS",
    setSessionCookies: (...args: unknown[]) => {
      calls.push(args);
    },
  } as unknown as SchoolsoftClient;
  return { client, calls };
}

const COOKIES = [
  "JSESSIONID=JS1; Path=/; HttpOnly",
  "hash=H1; Path=/",
  "usertype=2; Path=/",
  "clientType=; Path=/",
];

test("hits the parent eva-apps endpoint with user/org/child ids and installs cookies", async () => {
  const { client, calls } = fakeClient();
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const fetchImpl: ExchangeFetch = async (url, _school, options) => {
    seen.push({ url, headers: options.headers as Record<string, string> });
    return { status: 303, data: "", headers: {}, setCookies: COOKIES };
  };
  await exchangeTokenForCookies(client, {
    userType: "parent",
    userId: 42,
    orgId: 20,
    childInFocus: 777,
    fetchImpl,
  });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "https://sms.schoolsoft.se/testskola/eva-apps/auth/login/parent");
  assert.equal(seen[0].headers.token, "ACCESS");
  assert.equal(seen[0].headers.userId, "42");
  assert.equal(seen[0].headers.orgId, "20");
  assert.equal(seen[0].headers.childInFocus, "777");
  assert.match(seen[0].headers.redirecturl, /\/react\/#\/parent\//);
  assert.deepEqual(calls, [["JS1", "H1", "2"]]);
});

test("student user type uses the student endpoint and no childInFocus", async () => {
  const { client } = fakeClient();
  let url = "";
  let headers: Record<string, string> = {};
  const fetchImpl: ExchangeFetch = async (u, _s, o) => {
    url = u;
    headers = o.headers as Record<string, string>;
    return { status: 303, data: "", headers: {}, setCookies: COOKIES };
  };
  await exchangeTokenForCookies(client, { userType: "student", userId: 1, orgId: 2, fetchImpl });
  assert.match(url, /\/eva-apps\/auth\/login\/student$/);
  assert.equal(headers.childInFocus, undefined);
});

test("missing cookies fail with an actionable error", async () => {
  const { client } = fakeClient();
  const fetchImpl: ExchangeFetch = async () => ({
    status: 303,
    data: "",
    headers: { location: "https://sms.schoolsoft.se/x/eva-apps/auth/null?error=other" },
    setCookies: [],
  });
  await assert.rejects(
    exchangeTokenForCookies(client, { userType: "parent", userId: 1, orgId: 2, fetchImpl }),
    /Session exchange failed.*parent.*error=other/s,
  );
});

test("refuses to run without an access token", async () => {
  const client = { school: "s", accessToken: null } as unknown as SchoolsoftClient;
  await assert.rejects(
    exchangeTokenForCookies(client, {
      userType: "parent",
      userId: 1,
      orgId: 2,
      fetchImpl: async () => {
        throw new Error("should not be called");
      },
    }),
    /No access token/,
  );
});
