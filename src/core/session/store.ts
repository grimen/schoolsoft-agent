/**
 * Session persistence abstraction.
 *
 * `SessionStore` is the seam for Dependency Inversion: SessionManager
 * depends on this interface, never on the filesystem. Swap in an
 * OS-keychain-backed implementation or an in-memory fake for tests
 * without touching orchestration code.
 */
import type { GuardianContext } from "../portal/guardian.js";
import type { WebSession } from "../browser/web-login.js";

export interface PersistedSession {
  /** School portal provider id (absent in files written before the provider seam: SchoolSoft). */
  provider?: string;
  school: string;
  /** Provider-owned credentials (tokens, cookies…), opaque to core. */
  data: Record<string, unknown>;
  /** Guardian profile + child in focus. */
  guardian?: GuardianContext;
  /** Browser cookies from a real web login (passes login gates the app session cannot). */
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

const CORE_KEYS = new Set([
  "provider",
  "school",
  "data",
  "guardian",
  "web",
  "savedAt",
  "authMethod",
]);

/**
 * Sessions written before the provider seam kept SchoolSoft's tokens as
 * top-level fields; fold them into `data` so the provider reads one shape.
 */
export function migratePersisted(raw: Record<string, unknown>): PersistedSession {
  if (raw.data && typeof raw.data === "object") return raw as unknown as PersistedSession;
  const data: Record<string, unknown> = {};
  const core: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) (CORE_KEYS.has(k) ? core : data)[k] = v;
  return { ...core, data } as unknown as PersistedSession;
}
