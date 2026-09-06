/**
 * BankID-friendly interactive strategy: OAuth2+PKCE in the user's own
 * browser (see browser-flow.ts for the callback-server mechanics), then
 * guardian profile lookup and token → session-cookie exchange.
 *
 * Verified live (Täby, 2026-09-06). Sequence after the browser hands us
 * the code:
 *   1. code → access+refresh token (our oauth.ts; client id decides the
 *      token's user_type — vApp for guardians).
 *   2. GET /eva/api/v1/parent (Bearer) → userId + children.
 *   3. GET /eva-apps/auth/login/parent with userId/orgId/childInFocus →
 *      JSESSIONID+hash cookies for the /rest-api/parent/* endpoints.
 */
import type { SchoolsoftClient } from "@elias4044/ssp-node";
import type { AuthStrategy, LoginInfo } from "./strategy.js";
import type { PersistedSession } from "../services/store.js";
import { runBrowserLogin } from "./browser-flow.js";
import {
  DEFAULT_USER_TYPE,
  DEFAULT_CLIENT_ID_BY_USER_TYPE,
  type SchoolsoftUserType,
} from "../constants.js";
import { exchangeTokenForCookies, type ExchangeFetch } from "./session-exchange.js";
import { exchangeCode, refreshTokens, decodeJwtClaims, type TokenFetch } from "./oauth.js";
import {
  GuardianApi,
  childOf,
  orgIdOf,
  type GuardianContext,
  type ApiFetch,
} from "../api/guardian.js";

export interface BankIdBrowserOptions {
  orgid?: string;
  userType?: SchoolsoftUserType;
  clientId?: string;
  /** Test seams — production uses ssp-node's schoolsoftFetch. */
  fetchImpl?: ExchangeFetch & TokenFetch & ApiFetch;
  openBrowser?: (url: string) => void;
}

export class BankIdBrowserStrategy implements AuthStrategy {
  readonly id = "bankid-browser";
  context?: GuardianContext;

  constructor(private readonly options: BankIdBrowserOptions = {}) {}

  private get userType(): SchoolsoftUserType {
    return this.options.userType ?? DEFAULT_USER_TYPE;
  }
  private get clientId(): string {
    return this.options.clientId ?? DEFAULT_CLIENT_ID_BY_USER_TYPE[this.userType];
  }

  async login(client: SchoolsoftClient): Promise<LoginInfo> {
    const { result } = await runBrowserLogin({
      school: client.school,
      orgid: this.options.orgid,
      userType: this.userType,
      clientId: this.clientId,
      openBrowser: this.options.openBrowser,
    });
    const tokens = await exchangeCode({
      school: client.school,
      clientId: this.clientId,
      code: result.code,
      verifier: result.verifier,
      fetchImpl: this.options.fetchImpl,
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
    return this.establish(client, undefined);
  }

  async restore(client: SchoolsoftClient, saved: PersistedSession): Promise<void> {
    if (!saved.accessToken) {
      throw new Error("saved session has no access token");
    }
    client.setAccessToken(saved.accessToken, saved.refreshToken, saved.accessTokenExpiresAt);
    // Access tokens live ~15 min. Refresh up front when expired or when we
    // don't know (older sessions without a stored expiry).
    if (client.isAccessTokenExpired || saved.accessTokenExpiresAt == null) {
      await this.refresh(client);
    }
    try {
      await this.establish(client, saved.guardian?.childInFocus);
    } catch (e) {
      // Clock skew / early revocation: one refresh-and-retry before giving
      // up, since giving up costs the user a BankID round.
      if (!/HTTP 401/.test(String(e)) || !client.refreshToken) throw e;
      await this.refresh(client);
      await this.establish(client, saved.guardian?.childInFocus);
    }
  }

  private async refresh(client: SchoolsoftClient): Promise<void> {
    if (!client.refreshToken) {
      throw new Error("access token expired and no refresh token saved");
    }
    const t = await refreshTokens({
      school: client.school,
      clientId: this.clientId,
      refreshToken: client.refreshToken,
      fetchImpl: this.options.fetchImpl,
    });
    client.setAccessToken(
      t.accessToken,
      t.refreshToken ?? client.refreshToken,
      t.expiresAt ?? undefined,
    );
  }

  async focusChild(client: SchoolsoftClient, studentId: number): Promise<void> {
    if (!this.context) throw new Error("No guardian context — log in first.");
    const child = childOf(this.context, studentId); // validates
    await this.exchange(client, this.context, child.studentId);
    this.context = { ...this.context, childInFocus: child.studentId };
  }

  private api(client: SchoolsoftClient): GuardianApi {
    return new GuardianApi({
      school: client.school,
      accessToken: () => client.accessToken,
      cookieHeader: () => null,
      fetchImpl: this.options.fetchImpl,
    });
  }

  /** Look up the guardian profile, then bind cookies to a child. */
  private async establish(
    client: SchoolsoftClient,
    preferredChild: number | undefined,
  ): Promise<LoginInfo> {
    const parent = await this.api(client).getParent();
    if (!parent.children?.length) {
      throw new Error(
        "SchoolSoft returned a guardian profile with no children — nothing to show.",
      );
    }
    const childInFocus =
      parent.children.find((c) => c.studentId === preferredChild)?.studentId ??
      parent.children[0].studentId;
    const context: GuardianContext = {
      userId: parent.userId,
      parentName: `${parent.firstName} ${parent.lastName}`.trim(),
      children: parent.children,
      childInFocus,
    };
    await this.exchange(client, context, childInFocus);
    this.context = context;
    const child = childOf(context, childInFocus);
    return {
      name: context.parentName,
      schoolName: child.schools[0]?.name ?? null,
      userType: this.userType,
      children: parent.children.map((c) => ({ studentId: c.studentId, firstName: c.firstName })),
    };
  }

  private async exchange(
    client: SchoolsoftClient,
    context: GuardianContext,
    studentId: number,
  ): Promise<void> {
    const child = childOf(context, studentId);
    await exchangeTokenForCookies(client, {
      userType: this.userType,
      userId: context.userId,
      orgId: orgIdOf(child),
      childInFocus: child.studentId,
      fetchImpl: this.options.fetchImpl,
    });
  }
}
