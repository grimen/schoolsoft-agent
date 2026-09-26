/**
 * SchoolSoft's app OAuth2 + PKCE flow. SchoolSoft stamps the *user type*
 * into the issued token and resolves the actual user at use time, so
 * getting the route/client wrong (the student route, the `eApp` client id)
 * yields a token that fails every call with "Vi kunde inte hitta
 * användaren". Everything varying by user type / client id lives here.
 */
import { createHash, randomBytes } from "node:crypto";
import type { SchoolsoftUserType } from "../../../core/constants.js";
import { AgentError, UpstreamError, guardNetwork } from "../../../core/errors/index.js";
import type { FetchOptions } from "../net.js";
import { portalUrl } from "../web-login.js";

const MOBILE_UA = "SchoolSoftPlus-Mobile/1.0";

export interface AuthFlowStart {
  authUrl: string;
  verifier: string;
  state: string;
}

/** RFC 7636: a 32-byte random verifier and its S256 challenge, both base64url without padding. */
function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export function buildAuthUrl(options: {
  school: string;
  userType: SchoolsoftUserType;
  clientId: string;
  redirectUri: string;
  orgid?: string;
}): AuthFlowStart {
  const { verifier, challenge } = pkcePair();
  const state = randomBytes(12).toString("hex");
  const params = new URLSearchParams({
    code_challenge: challenge,
    code_challenge_method: "S256",
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    state,
    response_type: "code",
  });
  if (options.orgid) params.set("orgid", options.orgid);
  const authUrl =
    `https://sms.schoolsoft.se/${encodeURIComponent(options.school)}` +
    `/react/#/login/${options.userType}?${params.toString()}`;
  return { authUrl, verifier, state };
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  /** Unix seconds, or null if SchoolSoft did not say. */
  expiresAt: number | null;
}

/** Minimal shape of the provider's HTTP helper (net.ts, budgeted), injectable for tests. */
export type TokenFetch = (
  url: string,
  school: string,
  options: FetchOptions,
  userAgent: string,
) => Promise<{ status: number; data: unknown }>;

function parseTokenResponse(status: number, data: unknown, what: string): TokenSet {
  // A failing server is not a rejected login: keep the saved session and let the caller retry.
  if (status >= 500) throw new UpstreamError(status, what);
  if (status !== 200) {
    const said =
      data && typeof data === "object" && "userMessage" in data
        ? String((data as { userMessage: unknown }).userMessage)
        : `status ${status}`;
    throw new AgentError({
      kind: "not_authenticated",
      key: "token_exchange_failed",
      params: { what, detail: said },
      hint: "login",
    });
  }
  const d = (data ?? {}) as Record<string, unknown>;
  const accessToken = typeof d.access_token === "string" ? d.access_token : "";
  if (!accessToken)
    throw new AgentError({
      kind: "not_authenticated",
      key: "token_exchange_failed",
      params: { what, detail: "no access_token in the response" },
      hint: "login",
    });
  const refreshToken = typeof d.refresh_token === "string" ? d.refresh_token : null;
  // SchoolSoft has been seen omitting `expires`; fall back to the JWT exp.
  const expiresIn = typeof d.expires === "number" ? d.expires : null;
  const expiresAt =
    expiresIn !== null
      ? Math.floor(Date.now() / 1000) + expiresIn
      : (decodeJwtClaims(accessToken)?.exp ?? null);
  return { accessToken, refreshToken, expiresAt };
}

export async function exchangeCode(options: {
  school: string;
  clientId: string;
  code: string;
  verifier: string;
  fetchImpl: TokenFetch;
}): Promise<TokenSet> {
  const { fetchImpl } = options;
  const url =
    portalUrl(options.school, "/rest-api/login/token") +
    `?clientId=${encodeURIComponent(options.clientId)}` +
    `&grantType=code&code=${encodeURIComponent(options.code)}` +
    `&codeVerifier=${encodeURIComponent(options.verifier)}`;
  const r = await guardNetwork(() =>
    fetchImpl(
      url,
      options.school,
      {
        method: "POST",
        headers: { Accept: "application/json" },
        responseType: "json",
        redirect: "follow",
      },
      MOBILE_UA,
    ),
  );
  return parseTokenResponse(r.status, r.data, "Token exchange");
}

export async function refreshTokens(options: {
  school: string;
  clientId: string;
  refreshToken: string;
  fetchImpl: TokenFetch;
}): Promise<TokenSet> {
  const { fetchImpl } = options;
  const url =
    portalUrl(options.school, "/rest-api/login/token") +
    `?clientId=${encodeURIComponent(options.clientId)}` +
    `&grantType=refresh_token` +
    `&refreshToken=${encodeURIComponent(options.refreshToken)}`;
  const r = await guardNetwork(() =>
    fetchImpl(
      url,
      options.school,
      {
        method: "POST",
        headers: { Accept: "application/json" },
        responseType: "json",
        redirect: "follow",
      },
      MOBILE_UA,
    ),
  );
  return parseTokenResponse(r.status, r.data, "Token refresh");
}

export interface TokenClaims {
  user_type?: string;
  login_method?: string;
  client_id?: string;
  aud?: string;
  iss?: string;
  exp?: number;
  iat?: number;
}

/**
 * Decode (without verifying) the non-identifying claims of a SchoolSoft
 * access token. Deliberately drops `sub` and anything else unknown so the
 * result is safe to log.
 */
export function decodeJwtClaims(token: string): TokenClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const json = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
    ) as Record<string, unknown>;
    const pick = (k: string) => (typeof json[k] === "string" ? (json[k] as string) : undefined);
    const num = (k: string) => (typeof json[k] === "number" ? (json[k] as number) : undefined);
    return {
      user_type: pick("user_type"),
      login_method: pick("login_method"),
      client_id: pick("client_id"),
      aud: pick("aud"),
      iss: pick("iss"),
      exp: num("exp"),
      iat: num("iat"),
    };
  } catch {
    return null;
  }
}
