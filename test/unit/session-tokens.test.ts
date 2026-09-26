/** SessionTokens: the in-memory holder of one SchoolSoft session's tokens and cookies. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionTokens } from "../../src/providers/schoolsoft/tokens.js";

test("empty until set: no tokens, no cookie header, not expired", () => {
  const t = new SessionTokens("taby");
  assert.equal(t.school, "taby");
  assert.equal(t.accessToken, null);
  assert.equal(t.refreshToken, null);
  assert.equal(t.expiresAt, null);
  assert.equal(t.cookieHeader, null);
  assert.equal(t.isAccessTokenExpired, false, "an unknown expiry is not an expired one");
});

test("setAccessToken keeps the refresh token and expiry it is not given", () => {
  const t = new SessionTokens("taby");
  t.setAccessToken("A1", "R1", 1_800_000_000);
  t.setAccessToken("A2");
  assert.deepEqual([t.accessToken, t.refreshToken, t.expiresAt], ["A2", "R1", 1_800_000_000]);
  t.setAccessToken("A3", "R3", 1_800_000_900);
  assert.deepEqual([t.accessToken, t.refreshToken, t.expiresAt], ["A3", "R3", 1_800_000_900]);
});

test("the access token is expired from its expiry second on (Unix seconds)", () => {
  let now = 1_800_000_000_000 - 1;
  const t = new SessionTokens("taby", () => now);
  t.setAccessToken("A", undefined, 1_800_000_000);
  assert.equal(t.isAccessTokenExpired, false);
  now += 1;
  assert.equal(t.isAccessTokenExpired, true);
  assert.equal(new SessionTokens("taby").isAccessTokenExpired, false, "the real clock by default");
});

test("setSessionCookies builds the cookie header; usertype defaults to 1", () => {
  const t = new SessionTokens("taby");
  t.setSessionCookies("J", "H", "2");
  assert.equal(t.cookieHeader, "JSESSIONID=J; hash=H; usertype=2");
  t.setSessionCookies("J2", "H2");
  assert.equal(t.cookieHeader, "JSESSIONID=J2; hash=H2; usertype=1");
});
