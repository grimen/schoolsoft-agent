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
import type { VersionedFormat } from "../versioned.js";
import {
  accountKey,
  entryOf,
  withAccount,
  withoutAccount,
  type AccountsDocument,
} from "../accounts.js";

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

/** The session file from v2 on: one saved session per account (accounts.ts). */
export type SessionDocument = AccountsDocument<PersistedSession>;

/**
 * v1 → v2: the single saved session becomes the entry of the account it was
 * saved for. A session that names no school cannot be keyed; it throws, which
 * every loader treats as a corrupt file (logged out).
 */
export function keySessionByAccount(
  raw: PersistedSession & { version?: unknown },
): SessionDocument {
  const { version: _version, ...session } = raw;
  if (typeof session.school !== "string" || session.school === "") {
    throw new Error("saved session names no school");
  }
  return { accounts: { [accountKey(session.provider, session.school)]: session } };
}

/**
 * The persisted session's format (the local session.enc and the connector's
 * encrypted session). v0 → v1 is the pre-provider-seam fold above, v1 → v2
 * keys the session by account; a new format is one more migration here.
 */
export const SESSION_FORMAT: VersionedFormat = {
  migrations: [migratePersisted, keySessionByAccount],
};

/** Where a whole keyed document is read and written (a file, an encrypted repository). */
export interface DocumentRepository<D> {
  /** The document; null when there is none. May throw (a newer file, a store that fails closed). */
  read(): D | null;
  write(doc: D): void;
  /** Delete the document: called when its last account is cleared. */
  remove(): void;
}

/**
 * One account's view of a keyed session document: the SessionStore the
 * session manager already uses. Saving re-reads the document first, so an
 * entry another process wrote for another account in the meantime is kept.
 */
export function accountSessionStore(
  repo: DocumentRepository<SessionDocument>,
  account: string,
): SessionStore {
  return {
    load: () => entryOf<PersistedSession>(repo.read(), account) ?? null,
    save: (session) => repo.write(withAccount(repo.read() ?? { accounts: {} }, account, session)),
    clear: () => {
      const doc = repo.read();
      if (!doc || entryOf(doc, account) === undefined) return;
      const next = withoutAccount<SessionDocument, PersistedSession>(doc, account);
      if (Object.keys(next.accounts).length === 0) repo.remove();
      else repo.write(next);
    },
  };
}
