/**
 * BankID-friendly interactive strategy: OAuth2+PKCE in the user's own
 * browser (see browser-flow.ts for the callback-server mechanics), then
 * token → session-cookie exchange.
 */
import type { SchoolsoftClient } from "@elias4044/ssp-node";
import type { AuthStrategy, LoginInfo } from "./strategy.js";
import type { PersistedSession } from "../services/store.js";
import { runBrowserLogin } from "./browser-flow.js";
import { DEFAULT_USER_TYPE, type SchoolsoftUserType } from "../constants.js";
import { exchangeTokenForCookies } from "./session-exchange.js";

export class BankIdBrowserStrategy implements AuthStrategy {
  readonly id = "bankid-browser";

  constructor(
    private readonly options: {
      orgid?: string;
      userType?: SchoolsoftUserType;
    } = {},
  ) {}

  async login(client: SchoolsoftClient): Promise<LoginInfo> {
    const { result } = await runBrowserLogin({
      school: client.school,
      orgid: this.options.orgid,
      userType: this.options.userType,
    });
    await client.completeMobileFlow(result.code, result.verifier);
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
      await client.mobileRefresh();
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
      userType: this.options.userType ?? DEFAULT_USER_TYPE,
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
