/** SchoolsoftSession: the ProviderSession face over ssp-node's client. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SchoolsoftClient } from "@elias4044/ssp-node";
import { SchoolsoftSession } from "../../src/providers/schoolsoft/session.js";
import { NetworkError, UpstreamError } from "../../src/core/index.js";
import { noRequests } from "../helpers/budget.js";

const jwt = (payload: Record<string, unknown>) => {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "RS256" })}.${b64(payload)}.sig`;
};

test("fresh session: no cookies → null header, nothing to serialise; tokens serialise with the JWT expiry", async () => {
  const s = new SchoolsoftSession("taby", noRequests);
  assert.equal(s.school, "taby");
  assert.equal(s.cookieHeader(), null, "ssp-node throws without cookies; we answer null");
  assert.deepEqual(s.serialize(), {
    accessToken: undefined,
    refreshToken: undefined,
    accessTokenExpiresAt: undefined,
  });
  s.client.setAccessToken(jwt({ exp: 1_800_000_000 }), "R", 1_800_000_000);
  s.client.setSessionCookies("J", "H", "2");
  assert.equal(s.cookieHeader(), "JSESSIONID=J; hash=H; usertype=2");
  assert.deepEqual(s.serialize(), {
    accessToken: jwt({ exp: 1_800_000_000 }),
    refreshToken: "R",
    accessTokenExpiresAt: 1_800_000_000,
  });
});

test("verify asks GET /rest-api/session with the app cookies through the injected (budgeted) helper, never ssp-node's own", async () => {
  const seen: { url: string; cookie?: string }[] = [];
  let status = 200;
  const fetchImpl = async (
    url: string,
    _school: string,
    o: { headers?: Record<string, string> },
  ) => {
    seen.push({ url, cookie: o.headers?.Cookie });
    return { status, data: {} };
  };
  const client = new SchoolsoftClient({ school: "taby" });
  client.verifySession = async () =>
    assert.fail("ssp-node's verifySession reaches the portal around the budget");
  const s = new SchoolsoftSession("taby", fetchImpl, client);
  assert.equal(s.client, client);
  assert.equal(await s.verify(), false, "no cookies: nothing to verify, nothing sent");
  assert.equal(seen.length, 0);
  client.setSessionCookies("J", "H", "2");
  assert.equal(await s.verify(), true);
  assert.deepEqual(seen, [
    {
      url: "https://sms.schoolsoft.se/taby/rest-api/session",
      cookie: "JSESSIONID=J; hash=H; usertype=2",
    },
  ]);
  status = 401;
  assert.equal(await s.verify(), false, "a rejection means the session is gone");
});

test("verify: a transient failure says nothing about the session and is thrown, so the saved session is kept", async () => {
  const client = new SchoolsoftClient({ school: "taby" });
  client.setSessionCookies("J", "H", "2");
  const down = new SchoolsoftSession("taby", async () => ({ status: 503, data: null }), client);
  await assert.rejects(down.verify(), (e) => e instanceof UpstreamError && e.status === 503);
  const offline = new SchoolsoftSession(
    "taby",
    async () => {
      throw Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
    },
    client,
  );
  await assert.rejects(offline.verify(), NetworkError);
});
