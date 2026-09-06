/**
 * Unit tests for our own OAuth/PKCE helpers (auth URL, code exchange,
 * refresh, safe JWT decoding). HTTP is injected; no network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAuthUrl,
  exchangeCode,
  refreshTokens,
  decodeJwtClaims,
  type TokenFetch,
} from "../../src/providers/schoolsoft/auth/oauth.js";

function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "RS256", typ: "JWT" })}.${b64(payload)}.sig`;
}

test("buildAuthUrl targets the requested user type and client id", () => {
  const { authUrl, verifier, state } = buildAuthUrl({
    school: "taby",
    userType: "parent",
    clientId: "vApp",
    redirectUri: "http://127.0.0.1:43117/callback",
  });
  assert.match(authUrl, /^https:\/\/sms\.schoolsoft\.se\/taby\/react\/#\/login\/parent\?/);
  const q = new URLSearchParams(authUrl.split("?")[1]);
  assert.equal(q.get("client_id"), "vApp");
  assert.equal(q.get("redirect_uri"), "http://127.0.0.1:43117/callback");
  assert.equal(q.get("state"), state);
  assert.equal(q.get("response_type"), "code");
  assert.equal(q.get("code_challenge_method"), "S256");
  assert.ok(q.get("code_challenge"));
  assert.equal(q.get("orgid"), null, "no orgid unless asked");
  assert.ok(verifier.length > 20);
});

test("buildAuthUrl passes orgid through when given", () => {
  const { authUrl } = buildAuthUrl({
    school: "taby",
    userType: "student",
    clientId: "eApp",
    redirectUri: "x",
    orgid: "20",
  });
  assert.match(authUrl, /login\/student\?/);
  assert.match(authUrl, /orgid=20/);
});

test("exchangeCode posts to the token endpoint with the given client id", async () => {
  let seen = "";
  const fetchImpl: TokenFetch = async (url) => {
    seen = url;
    return {
      status: 200,
      data: { access_token: jwt({ exp: 123 }), refresh_token: "R", expires: 900 },
    };
  };
  const t = await exchangeCode({
    school: "taby",
    clientId: "vApp",
    code: "C",
    verifier: "V",
    fetchImpl,
  });
  assert.match(
    seen,
    /\/taby\/rest-api\/login\/token\?clientId=vApp&grantType=code&code=C&codeVerifier=V$/,
  );
  assert.equal(t.refreshToken, "R");
  assert.ok(t.expiresAt! > Math.floor(Date.now() / 1000) + 800);
});

test("exchangeCode falls back to the JWT exp when expires is missing", async () => {
  const fetchImpl: TokenFetch = async () => ({
    status: 200,
    data: { access_token: jwt({ exp: 1788706637 }), refresh_token: "R" },
  });
  const t = await exchangeCode({
    school: "taby",
    clientId: "eApp",
    code: "C",
    verifier: "V",
    fetchImpl,
  });
  assert.equal(t.expiresAt, 1788706637);
});

test("exchangeCode surfaces SchoolSoft's userMessage on failure", async () => {
  const fetchImpl: TokenFetch = async () => ({
    status: 404,
    data: { userMessage: "Ingen aktiv inloggnings-session" },
  });
  await assert.rejects(
    exchangeCode({ school: "taby", clientId: "eApp", code: "C", verifier: "V", fetchImpl }),
    /Ingen aktiv inloggnings-session/,
  );
});

test("refreshTokens uses the refresh grant with the same client id", async () => {
  let seen = "";
  const fetchImpl: TokenFetch = async (url) => {
    seen = url;
    return {
      status: 200,
      data: { access_token: jwt({ exp: 5 }), refresh_token: "R2", expires: 10 },
    };
  };
  const t = await refreshTokens({
    school: "taby",
    clientId: "vApp",
    refreshToken: "R1",
    fetchImpl,
  });
  assert.match(seen, /clientId=vApp&grantType=refresh_token&refreshToken=R1$/);
  assert.equal(t.refreshToken, "R2");
});

test("decodeJwtClaims returns only non-identifying claims", () => {
  const c = decodeJwtClaims(
    jwt({
      sub: "secret-uuid",
      user_type: "STUDENT",
      login_method: "SAML",
      client_id: "eApp",
      exp: 1,
      iat: 0,
    }),
  );
  assert.deepEqual(c, {
    user_type: "STUDENT",
    login_method: "SAML",
    client_id: "eApp",
    aud: undefined,
    iss: undefined,
    exp: 1,
    iat: 0,
  });
  assert.ok(!JSON.stringify(c).includes("secret-uuid"));
  assert.equal(decodeJwtClaims("not-a-jwt"), null);
});

test("token response parsing: userMessage, missing access_token, no refresh/expires (JWT exp fallback), invalid JWT", async () => {
  const fetchWith =
    (status: number, data: unknown): TokenFetch =>
    async () => ({ status, data });
  const base = { school: "taby", clientId: "vApp", code: "c", verifier: "v" };
  await assert.rejects(
    exchangeCode({ ...base, fetchImpl: fetchWith(400, { userMessage: "Ogiltig kod" }) }),
    /Ogiltig kod/,
  );
  await assert.rejects(
    exchangeCode({ ...base, fetchImpl: fetchWith(500, "nope") }),
    /status 500\)\.$/,
  );
  await assert.rejects(
    exchangeCode({ ...base, fetchImpl: fetchWith(200, null) }),
    /no access_token/,
  );
  const token = jwt({ exp: 1_800_000_000 });
  const t = await exchangeCode({ ...base, fetchImpl: fetchWith(200, { access_token: token }) });
  assert.deepEqual(t, { accessToken: token, refreshToken: null, expiresAt: 1_800_000_000 });
  const opaque = await refreshTokens({
    school: "taby",
    clientId: "vApp",
    refreshToken: "r",
    fetchImpl: fetchWith(200, { access_token: "not-a-jwt" }),
  });
  assert.deepEqual(opaque, { accessToken: "not-a-jwt", refreshToken: null, expiresAt: null });
  assert.equal(decodeJwtClaims("a.!!!not-base64-json.c"), null);
});
