/**
 * BankID-friendly interactive strategy: OAuth2+PKCE in the user's own
 * browser (see browser-flow.ts for the callback-server mechanics), then
 * token → session-cookie exchange.
 */
import type { SchoolsoftClient } from "@elias4044/ssp-node";
import type { AuthStrategy, LoginInfo } from "./strategy.js";
import type { PersistedSession } from "../services/store.js";
import { runBrowserLogin } from "./browser-flow.js";
import {
  DEFAULT_USER_TYPE,
  DEFAULT_CLIENT_ID,
  type SchoolsoftUserType,
} from "../constants.js";
import { exchangeTokenForCookies } from "./session-exchange.js";
import { exchangeCode, refreshTokens, decodeJwtClaims } from "./oauth.js";

export class BankIdBrowserStrategy implements AuthStrategy {
  readonly id = "bankid-browser";

  constructor(
    private readonly options: {
      orgid?: string;
      userType?: SchoolsoftUserType;
      clientId?: string;
    } = {},
  ) {}

  private get userType(): SchoolsoftUserType {
    return this.options.userType ?? DEFAULT_USER_TYPE;
  }
  private get clientId(): string {
    return this.options.clientId ?? DEFAULT_CLIENT_ID;
  }

  async login(client: SchoolsoftClient): Promise<LoginInfo> {
    const { result } = await runBrowserLogin({
      school: client.school,
      orgid: this.options.orgid,
      userType: this.userType,
      clientId: this.clientId,
    });
    const tokens = await exchangeCode({
      school: client.school,
      clientId: this.clientId,
      code: result.code,
      verifier: result.verifier,
    });
    client.setAccessToken(
      tokens.accessToken,
      tokens.refreshToken ?? undefined,
      tokens.expiresAt ?? undefined,
    );
    // Diagnostic (stderr, non-identifying): SchoolSoft stamps the user
    // type into the token; a mismatch with what we asked for explains
    // every downstream "Vi kunde inte hitta användaren".
    const claims = decodeJwtClaims(tokens.accessToken);
    console.error(
      `schoolsoft token: requested userType=${this.userType} clientId=${this.clientId} → ` +
        `got user_type=${claims?.user_type} client_id=${claims?.client_id} ` +
        `login_method=${claims?.login_method} exp=${claims?.exp}`,
    );
    return this.exchange(client);
  }

  async restore(
    client: SchoolsoftClient,
    saved: PersistedSession,
  ): Promise<void> {
    if (!saved.accessToken) {
      throw new Error("saved session has no access token");
    }
    client.setAccessToken(
      saved.accessToken,
      saved.refreshToken,
      saved.accessTokenExpiresAt,
    );
    if (client.isAccessTokenExpired) {
      if (!client.refreshToken) {
        throw new Error("access token expired and no refresh token saved");
      }
      const t = await refreshTokens({
        school: client.school,
        clientId: this.clientId,
        refreshToken: client.refreshToken,
      });
      client.setAccessToken(
        t.accessToken,
        t.refreshToken ?? client.refreshToken,
        t.expiresAt ?? undefined,
      );
    }
    await this.exchange(client);
  }

  /**
   * Exchange the access token for web session cookies. Uses our own
   * user-type-aware exchange rather than ssp-node's student-only one.
   */
  private async exchange(client: SchoolsoftClient): Promise<LoginInfo> {
    const info = await client.fetchMobileSessionInfo();
    await exchangeTokenForCookies(client, {
      userType: this.userType,
      userId: info?.userId,
      orgid: this.options.orgid,
    });
    return {
      name: info ? `${info.firstName} ${info.lastName}`.trim() : null,
      schoolName: info?.schoolName ?? null,
      userType: info?.userType ?? null,
    };
  }
}
