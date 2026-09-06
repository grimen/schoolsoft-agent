/** SchoolsoftSession: the ProviderSession face over ssp-node's client. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SchoolsoftClient } from "@elias4044/ssp-node";
import { SchoolsoftSession } from "../../src/providers/schoolsoft/session.js";

const jwt = (payload: Record<string, unknown>) => {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "RS256" })}.${b64(payload)}.sig`;
};

test("fresh session: no cookies → null header, nothing to serialise; tokens serialise with the JWT expiry", async () => {
  const s = new SchoolsoftSession("taby");
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

test("verify delegates to the wrapped client; a client can be injected", async () => {
  const client = { verifySession: async () => true } as unknown as SchoolsoftClient;
  const s = new SchoolsoftSession("taby", client);
  assert.equal(await s.verify(), true);
  assert.equal(s.client, client);
});
