/**
 * SchoolSoft's app OAuth2 + PKCE flow, implemented here instead of via
 * ssp-node because ssp-node hardcodes the student route and the `eApp`
 * client id. SchoolSoft stamps the *user type* into the issued token and
 * resolves the actual user at use time, so getting the route/client wrong
 * yields a token that fails every call with "Vi kunde inte hitta
 * användaren". Everything varying by user type / client id lives here.
 */
import { makePkcePair, makeState, schoolsoftFetch, ssUrl } from "@elias4044/ssp-node";
import type { SchoolsoftUserType } from "../constants.js";

const MOBILE_UA = "SchoolSoftPlus-Mobile/1.0";

export interface AuthFlowStart {
  authUrl: string;
  verifier: string;
  state: string;
}

export function buildAuthUrl(options: {
  school: string;
  userType: SchoolsoftUserType;
  clientId: string;
  redirectUri: string;
  orgid?: string;
}): AuthFlowStart {
  const { verifier, challenge } = makePkcePair();
  const state = makeState();
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

/** Minimal shape of ssp-node's schoolsoftFetch, injectable for tests. */
export type TokenFetch = (
  url: string,
  school: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    responseType?: "json" | "text" | "buffer";
  },
  userAgent?: string,
) => Promise<{ status: number; data: unknown }>;

function parseTokenResponse(status: number, data: unknown, what: string): TokenSet {
  if (status !== 200) {
    const msg =
      data && typeof data === "object" && "userMessage" in data
        ? ` SchoolSoft says: ${String((data as { userMessage: unknown }).userMessage)}`
        : "";
    throw new Error(`${what} failed — status ${status}.${msg}`);
  }
  const d = (data ?? {}) as Record<string, unknown>;
  const accessToken = typeof d.access_token === "string" ? d.access_token : "";
  if (!accessToken) throw new Error(`${what} failed — no access_token in response.`);
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
  fetchImpl?: TokenFetch;
}): Promise<TokenSet> {
  const fetchImpl = options.fetchImpl ?? (schoolsoftFetch as TokenFetch);
  const url =
    ssUrl(options.school, "/rest-api/login/token") +
    `?clientId=${encodeURIComponent(options.clientId)}` +
    `&grantType=code&code=${encodeURIComponent(options.code)}` +
    `&codeVerifier=${encodeURIComponent(options.verifier)}`;
  const r = await fetchImpl(url, options.school, {
    method: "POST",
    headers: { Accept: "application/json" },
    responseType: "json",
  }, MOBILE_UA);
  return parseTokenResponse(r.status, r.data, "Token exchange");
}

export async function refreshTokens(options: {
  school: string;
  clientId: string;
  refreshToken: string;
  fetchImpl?: TokenFetch;
}): Promise<TokenSet> {
  const fetchImpl = options.fetchImpl ?? (schoolsoftFetch as TokenFetch);
  const url =
    ssUrl(options.school, "/rest-api/login/token") +
    `?clientId=${encodeURIComponent(options.clientId)}` +
    `&grantType=refresh_token` +
    `&refreshToken=${encodeURIComponent(options.refreshToken)}`;
  const r = await fetchImpl(url, options.school, {
    method: "POST",
    headers: { Accept: "application/json" },
    responseType: "json",
  }, MOBILE_UA);
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
