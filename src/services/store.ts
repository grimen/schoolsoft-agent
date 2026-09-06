/**
 * Session persistence abstraction.
 *
 * `SessionStore` is the seam for Dependency Inversion: SessionManager
 * depends on this interface, never on the filesystem. Swap in an
 * OS-keychain-backed implementation (keytar / DPAPI / Secret Service)
 * or an in-memory fake for tests without touching orchestration code.
 */

export interface PersistedSession {
  school: string;
  /** OAuth tokens from the mobile flow. */
  accessToken?: string;
  refreshToken?: string;
  accessTokenExpiresAt?: number;
  /** Web session cookies (simple login or post-exchange). */
  jsessionid?: string;
  hash?: string;
  usertype?: string;
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
