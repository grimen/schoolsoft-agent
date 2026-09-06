/**
 * Session persistence abstraction.
 *
 * `SessionStore` is the seam for Dependency Inversion: SessionManager
 * depends on this interface, never on the filesystem. Swap in an
 * OS-keychain-backed implementation (keytar / DPAPI / Secret Service)
 * or an in-memory fake for tests without touching orchestration code.
 */
import type { GuardianContext } from "../portal/guardian.js";
import type { WebSession } from "../browser/web-login.js";

export interface PersistedSession {
  school: string;
  /** OAuth tokens from the mobile flow. */
  accessToken?: string;
  refreshToken?: string;
  /** Unix SECONDS (ssp-node convention), not ms. */
  accessTokenExpiresAt?: number;
  /** Web session cookies (simple login or post-exchange). */
  jsessionid?: string;
  hash?: string;
  usertype?: string;
  /** Guardian profile + child in focus (see src/api/guardian.ts). */
  guardian?: GuardianContext;
  /** Browser cookies from a real web login (passes the GDPR gate). */
  web?: WebSession;
  /** Bookkeeping. */
  savedAt: number;
  authMethod: string;
}

export interface SessionStore {
  save(session: PersistedSession): void;
  load(): PersistedSession | null;
  clear(): void;
}

/** In-memory store for tests. */
export class MemorySessionStore implements SessionStore {
  private session: PersistedSession | null = null;
  save(session: PersistedSession): void {
    this.session = session;
  }
  load(): PersistedSession | null {
    return this.session;
  }
  clear(): void {
    this.session = null;
  }
}
