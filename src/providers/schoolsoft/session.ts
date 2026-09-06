/**
 * SchoolSoft's live session object: ssp-node's SchoolsoftClient as the
 * token/cookie holder, plus what core needs from a ProviderSession.
 */
import { SchoolsoftClient } from "@elias4044/ssp-node";
import type { ProviderSession } from "../../core/provider/types.js";
import { decodeJwtClaims } from "./auth/oauth.js";

export interface SchoolsoftCredentials {
  accessToken?: string;
  refreshToken?: string;
  /** Unix SECONDS (ssp-node convention), not ms. */
  accessTokenExpiresAt?: number;
}

export class SchoolsoftSession implements ProviderSession {
  readonly client: SchoolsoftClient;
  constructor(
    readonly school: string,
    client?: SchoolsoftClient,
  ) {
    this.client = client ?? new SchoolsoftClient({ school });
  }

  verify(): Promise<boolean> {
    return this.client.verifySession();
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
