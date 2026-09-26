/** Single-owner OAuth grants; storage is supplied by the encrypted deployment store. */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Response } from "express";
import type {
  OAuthServerProvider,
  AuthorizationParams,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import {
  InvalidClientMetadataError,
  InvalidGrantError,
  InvalidRequestError,
  InvalidScopeError,
  InvalidTargetError,
  InvalidTokenError,
  TemporarilyUnavailableError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type {
  OAuthClientInformationFull,
  OAuthTokens,
  OAuthTokenRevocationRequest,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

export interface ConnectorGrant {
  resourceUrl: string;
  id: string;
  clientId: string;
  clientName: string;
  scopes: string[];
  childIds: number[];
  createdAt: number;
  expiresAt: number;
}
export interface PendingConsent {
  id: string;
  clientId: string;
  clientName: string;
  scopes: string[];
  redirectUri: string;
  state?: string;
  challenge: string;
  expiresAt: number;
}
interface Code {
  clientId: string;
  grantId: string;
  redirectUri: string;
  challenge: string;
  expiresAt: number;
}
interface Token {
  clientId: string;
  grantId: string;
  scopes: string[];
  expiresAt: number;
}
export interface OAuthState {
  clients: Record<string, OAuthClientInformationFull>;
  pending: Record<string, PendingConsent>;
  codes: Record<string, Code>;
  grants: Record<string, ConnectorGrant>;
  tokens: Record<string, Token>;
  refresh: Record<string, { key: string; counter: number; scopes: string[] }>;
}
export interface OAuthRepository {
  read(): OAuthState | undefined;
  write(state: OAuthState): void;
}
interface Options {
  resourceUrl: string;
  scopes: string[];
  repository: OAuthRepository;
  now?: () => number;
  randomToken?: () => string;
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const DAY = 86_400_000;

/** Callback destinations are exact known vendor paths; never fetch client-supplied URLs. */
export function approvedRedirect(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  )
    return false;
  return (
    (url.hostname === "claude.ai" && url.pathname === "/api/mcp/auth_callback") ||
    (url.hostname === "chatgpt.com" &&
      (url.pathname === "/connector_platform_oauth_redirect" ||
        /^\/connector\/oauth\/[a-zA-Z0-9_-]+$/.test(url.pathname)))
  );
}

export class ConnectorOAuthProvider implements OAuthServerProvider {
  readonly clientsStore: OAuthRegisteredClientsStore;
  private state: OAuthState;
  private readonly now: () => number;
  private readonly random: () => string;
  constructor(private readonly options: Options) {
    this.now = options.now ?? Date.now;
    this.random = options.randomToken ?? (() => randomBytes(32).toString("base64url"));
    this.state = options.repository.read() ?? {
      clients: {},
      pending: {},
      codes: {},
      grants: {},
      tokens: {},
      refresh: {},
    };
    this.clientsStore = {
      getClient: (id) =>
        Object.hasOwn(this.state.clients, id) ? structuredClone(this.state.clients[id]) : undefined,
      registerClient: (client) => {
        if (!client.redirect_uris.length || !client.redirect_uris.every(approvedRedirect))
          throw new InvalidClientMetadataError("Unsupported callback URL");
        this.prune();
        for (const [id, existing] of Object.entries(this.state.clients)) {
          if (
            (existing.client_id_issued_at ?? 0) * 1000 + DAY <= this.now() &&
            !Object.values(this.state.grants).some((grant) => grant.clientId === id) &&
            !Object.values(this.state.pending).some((pending) => pending.clientId === id)
          )
            delete this.state.clients[id];
        }
        if (Object.keys(this.state.clients).length >= 256)
          throw new TemporarilyUnavailableError("Client registration limit reached");
        const registered = {
          ...client,
          client_id: this.random(),
          client_id_issued_at: Math.floor(this.now() / 1000),
        };
        this.state.clients[registered.client_id] = registered;
        this.save();
        return structuredClone(registered);
      },
    };
  }
  private save(): void {
    this.options.repository.write(structuredClone(this.state));
  }
  private prune(): void {
    for (const [id, pending] of Object.entries(this.state.pending))
      if (pending.expiresAt <= this.now()) delete this.state.pending[id];
    for (const [id, code] of Object.entries(this.state.codes))
      if (code.expiresAt <= this.now()) delete this.state.codes[id];
    for (const [id, token] of Object.entries(this.state.tokens))
      if (token.expiresAt <= this.now()) delete this.state.tokens[id];
    for (const [id, grant] of Object.entries(this.state.grants))
      if (grant.expiresAt <= this.now()) {
        delete this.state.grants[id];
        delete this.state.refresh[id];
      }
  }
  private resource(resource: URL | undefined): void {
    if (resource?.href !== this.options.resourceUrl)
      throw new InvalidTargetError("Invalid resource");
  }
  private scopes(scopes: string[], allowed = this.options.scopes): string[] {
    if (!scopes.length || scopes.some((scope) => !allowed.includes(scope)))
      throw new InvalidScopeError("Invalid scope");
    return [...new Set(scopes)];
  }
  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    this.resource(params.resource);
    if (
      !client.redirect_uris.includes(params.redirectUri) ||
      !approvedRedirect(params.redirectUri) ||
      !/^[A-Za-z0-9_-]{43}$/.test(params.codeChallenge)
    )
      throw new InvalidRequestError("Invalid authorization request");
    this.prune();
    if (Object.keys(this.state.pending).length >= 128)
      throw new TemporarilyUnavailableError("Authorization limit reached");
    const id = this.random();
    this.state.pending[id] = {
      id,
      clientId: client.client_id,
      clientName: client.client_name ?? "AI connector",
      scopes: this.scopes(params.scopes ?? this.options.scopes),
      redirectUri: params.redirectUri,
      state: params.state,
      challenge: params.codeChallenge,
      expiresAt: this.now() + 10 * 60_000,
    };
    this.save();
    res.redirect(`/owner/consent?request=${encodeURIComponent(id)}`);
  }
  pending(id: string): PendingConsent {
    const request = Object.hasOwn(this.state.pending, id) ? this.state.pending[id] : undefined;
    if (!request || request.expiresAt <= this.now())
      throw new InvalidGrantError("Consent request expired");
    return structuredClone(request);
  }
  approve(id: string, scopes?: string[], childIds: number[] = []): string {
    const pending = this.pending(id);
    const selected = this.scopes(scopes ?? pending.scopes, pending.scopes);
    if (!childIds.length || childIds.some((child) => !Number.isSafeInteger(child) || child <= 0))
      throw new InvalidRequestError("Choose at least one child");
    this.prune();
    if (Object.keys(this.state.grants).length >= 64)
      throw new TemporarilyUnavailableError("Connection limit reached");
    const grantId = this.random();
    this.state.grants[grantId] = {
      resourceUrl: this.options.resourceUrl,
      id: grantId,
      clientId: pending.clientId,
      clientName: pending.clientName,
      scopes: selected,
      childIds: [...new Set(childIds)],
      createdAt: this.now(),
      expiresAt: this.now() + 30 * DAY,
    };
    const code = this.random();
    this.state.codes[hash(code)] = {
      clientId: pending.clientId,
      grantId,
      redirectUri: pending.redirectUri,
      challenge: pending.challenge,
      expiresAt: this.now() + 60_000,
    };
    delete this.state.pending[id];
    this.save();
    return this.redirect(pending, "code", code);
  }
  deny(id: string): string {
    const pending = this.pending(id);
    delete this.state.pending[id];
    this.save();
    return this.redirect(pending, "error", "access_denied");
  }
  private redirect(pending: PendingConsent, key: string, value: string): string {
    const url = new URL(pending.redirectUri);
    url.searchParams.set(key, value);
    if (pending.state !== undefined) url.searchParams.set("state", pending.state);
    return url.href;
  }
  private code(client: OAuthClientInformationFull, code: string): Code {
    const stored = this.state.codes[hash(code)];
    if (!stored || stored.clientId !== client.client_id || stored.expiresAt <= this.now())
      throw new InvalidGrantError("Invalid authorization code");
    this.verifyGrant(stored.grantId);
    return stored;
  }
  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    code: string,
  ): Promise<string> {
    return this.code(client, code).challenge;
  }
  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    code: string,
    _verifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    this.resource(resource);
    const stored = this.code(client, code);
    if (redirectUri !== stored.redirectUri) throw new InvalidGrantError("Invalid redirect URI");
    return this.issue(
      this.verifyGrant(stored.grantId),
      this.state.grants[stored.grantId].scopes,
      hash(code),
    );
  }
  // Authenticate every rotation counter so old-token replay remains detectable without
  // retaining a growing token history. The per-grant key stays in encrypted storage.
  private refreshMac(id: string, counter: string, key: string): string {
    return createHmac("sha256", key).update(`${id}.${counter}`).digest("base64url");
  }
  private readRefresh(value: string): { id: string; counter: number } | undefined {
    const parts = value.split(".");
    if (parts.length !== 3 || !/^(0|[1-9][0-9]*)$/.test(parts[1])) return undefined;
    const [id, counter, signature] = parts;
    const current = Object.hasOwn(this.state.refresh, id) ? this.state.refresh[id] : undefined;
    if (!current || !Number.isSafeInteger(Number(counter))) return undefined;
    const expected = Buffer.from(this.refreshMac(id, counter, current.key));
    const received = Buffer.from(signature);
    if (expected.length !== received.length || !timingSafeEqual(expected, received))
      return undefined;
    return { id, counter: Number(counter) };
  }
  private issue(grant: ConnectorGrant, scopes: string[], codeHash?: string): OAuthTokens {
    this.prune();
    if (Object.keys(this.state.tokens).length >= 8192)
      throw new TemporarilyUnavailableError("Token limit reached");
    const next = structuredClone(this.state);
    const current = next.refresh[grant.id] ?? { key: this.random(), counter: 0, scopes };
    current.counter += 1;
    current.scopes = scopes;
    next.refresh[grant.id] = current;
    const access = this.random();
    const refresh = `${grant.id}.${current.counter}.${this.refreshMac(grant.id, String(current.counter), current.key)}`;
    next.tokens[hash(access)] = {
      clientId: grant.clientId,
      grantId: grant.id,
      scopes,
      expiresAt: this.now() + 5 * 60_000,
    };
    if (codeHash !== undefined) delete next.codes[codeHash];
    // Publish the next state only after persistence succeeds; failed issuance is retryable.
    this.options.repository.write(structuredClone(next));
    this.state = next;
    return {
      access_token: access,
      refresh_token: refresh,
      token_type: "Bearer",
      expires_in: 300,
      scope: scopes.join(" "),
    };
  }
  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refresh: string,
    scopes?: string[],
    resource?: URL,
  ): Promise<OAuthTokens> {
    this.resource(resource);
    const parsed = this.readRefresh(refresh);
    if (!parsed) throw new InvalidGrantError("Invalid refresh token");
    const grant = this.verifyGrant(parsed.id);
    if (grant.clientId !== client.client_id) throw new InvalidGrantError("Invalid refresh token");
    const current = this.state.refresh[parsed.id];
    if (parsed.counter !== current.counter) {
      this.revokeGrant(parsed.id);
      throw new InvalidGrantError("Refresh token reused; reconnect this client");
    }
    const selected = this.scopes(scopes ?? current.scopes, current.scopes);
    return this.issue(grant, selected);
  }
  verifyGrant(id: string): ConnectorGrant {
    const grant = Object.hasOwn(this.state.grants, id) ? this.state.grants[id] : undefined;
    if (!grant || grant.expiresAt <= this.now() || grant.resourceUrl !== this.options.resourceUrl)
      throw new InvalidTokenError("Connection expired or revoked");
    return structuredClone(grant);
  }
  async verifyAccessToken(access: string): Promise<AuthInfo> {
    const token = this.state.tokens[hash(access)];
    if (!token || token.expiresAt <= this.now())
      throw new InvalidTokenError("Invalid access token");
    this.verifyGrant(token.grantId);
    return {
      token: access,
      clientId: token.clientId,
      scopes: [...token.scopes],
      expiresAt: Math.floor(token.expiresAt / 1000),
      resource: new URL(this.options.resourceUrl),
      extra: { grantId: token.grantId },
    };
  }
  listGrants(): ConnectorGrant[] {
    this.prune();
    return structuredClone(Object.values(this.state.grants));
  }
  revokeGrant(id: string): void {
    if (Object.hasOwn(this.state.grants, id)) {
      delete this.state.grants[id];
      delete this.state.refresh[id];
      for (const [key, token] of Object.entries(this.state.tokens))
        if (token.grantId === id) delete this.state.tokens[key];
      for (const [key, code] of Object.entries(this.state.codes))
        if (code.grantId === id) delete this.state.codes[key];
      this.save();
    }
  }
  revokeAll(): void {
    this.state.grants = {};
    this.state.refresh = {};
    this.state.tokens = {};
    this.state.pending = {};
    this.state.codes = {};
    this.save();
  }
  async revokeToken(
    client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
  ): Promise<void> {
    const token = this.state.tokens[hash(request.token)];
    if (token && token.clientId === client.client_id) this.revokeGrant(token.grantId);
    const refresh = this.readRefresh(request.token);
    if (refresh && this.state.grants[refresh.id]?.clientId === client.client_id)
      this.revokeGrant(refresh.id);
  }
}
