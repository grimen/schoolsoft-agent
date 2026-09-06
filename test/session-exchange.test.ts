/**
 * Unit tests for the user-type-aware token → cookie exchange. The HTTP
 * call is injected, so no network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SchoolsoftClient } from "@elias4044/ssp-node";
import {
  exchangeTokenForCookies,
  type ExchangeFetch,
} from "../src/auth/session-exchange.js";

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

test("hits the parent eva-apps endpoint and installs the cookies", async () => {
  const { client, calls } = fakeClient();
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const fetchImpl: ExchangeFetch = async (url, _school, options) => {
    seen.push({ url, headers: options.headers as Record<string, string> });
    return {
      status: 303,
      data: "",
      headers: {},
      setCookies: [
        "JSESSIONID=JS1; Path=/; HttpOnly",
        "hash=H1; Path=/",
        "usertype=2; Path=/",
      ],
    };
  };
  await exchangeTokenForCookies(client, {
    userType: "parent",
    userId: 42,
    fetchImpl,
  });
  assert.equal(seen.length, 1);
  assert.equal(
    seen[0].url,
    "https://sms.schoolsoft.se/testskola/eva-apps/auth/login/parent",
  );
  assert.equal(seen[0].headers.token, "ACCESS");
  assert.equal(seen[0].headers.userid, "42");
  assert.match(seen[0].headers.redirecturl, /\/react\/#\/parent\//);
  assert.deepEqual(calls, [["JS1", "H1", "2"]]);
});

test("student user type uses the student endpoint", async () => {
  const { client } = fakeClient();
  let url = "";
  const fetchImpl: ExchangeFetch = async (u) => {
    url = u;
    return {
      status: 303,
      data: "",
      headers: {},
      setCookies: ["JSESSIONID=a; Path=/", "hash=b; Path=/"],
    };
  };
  await exchangeTokenForCookies(client, { userType: "student", fetchImpl });
  assert.match(url, /\/eva-apps\/auth\/login\/student$/);
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
    exchangeTokenForCookies(client, { userType: "parent", fetchImpl }),
    /Session exchange failed.*parent.*error=other/s,
  );
});

test("refuses to run without an access token", async () => {
  const client = { school: "s", accessToken: null } as unknown as SchoolsoftClient;
  await assert.rejects(
    exchangeTokenForCookies(client, { userType: "parent", fetchImpl: async () => { throw new Error("should not be called"); } }),
    /No access token/,
  );
});
