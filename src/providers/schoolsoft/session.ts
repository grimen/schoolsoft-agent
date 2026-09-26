/**
 * SchoolSoft's live session object: ssp-node's SchoolsoftClient as the
 * token/cookie holder, plus what core needs from a ProviderSession. Its one
 * request (is the session still accepted?) goes through the provider's
 * budgeted transport, never ssp-node's own `verifySession`, which would
 * reach the portal around the request budget.
 */
import { SchoolsoftClient } from "@elias4044/ssp-node";
import type { ProviderSession } from "../../core/provider/types.js";
import { isTransient } from "../../core/errors/index.js";
import { decodeJwtClaims } from "./auth/oauth.js";
import { SchoolsoftHttp, type ApiFetch } from "./portal/api/transport.js";

export interface SchoolsoftCredentials {
  accessToken?: string;
  refreshToken?: string;
  /** Unix SECONDS (ssp-node convention), not ms. */
  accessTokenExpiresAt?: number;
}

export class SchoolsoftSession implements ProviderSession {
  readonly client: SchoolsoftClient;
  private readonly http: SchoolsoftHttp;
  constructor(
    readonly school: string,
    /** The budgeted HTTP helper (net.ts) in production, a fake in tests. */
    fetchImpl: ApiFetch,
    client?: SchoolsoftClient,
  ) {
    this.client = client ?? new SchoolsoftClient({ school });
    this.http = new SchoolsoftHttp(school, fetchImpl);
  }

  /**
   * `GET /rest-api/session` with the app cookies answers 200 while the
   * session lives. A rejection or any other answer means it is gone; a
   * transient failure (network, 5xx, the portal pushing back) says nothing
   * about the session and is thrown, so the saved session is kept.
   */
  async verify(): Promise<boolean> {
    const cookie = this.cookieHeader();
    if (!cookie) return false;
    try {
      await this.http.get("/rest-api/session", { Cookie: cookie });
      return true;
    } catch (e) {
      if (isTransient(e)) throw e;
      return false;
    }
  }

  cookieHeader(): string | null {
    try {
      return this.client.cookieHeader;
    } catch {
      return null;
    }
  }

  /** Credentials to persist; the JWT carries the expiry (ssp-node exposes no getter). */
  serialize(): SchoolsoftCredentials {
    const c = this.client;
    return {
      accessToken: c.accessToken ?? undefined,
      refreshToken: c.refreshToken ?? undefined,
      accessTokenExpiresAt: c.accessToken ? decodeJwtClaims(c.accessToken)?.exp : undefined,
    };
  }
}
