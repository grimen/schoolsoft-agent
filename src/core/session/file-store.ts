/**
 * File-backed SessionStore: session.enc under the state directory, sealed
 * with the directory's key.bin (sealed.ts, which says what that protects
 * against).
 */
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  SESSION_FORMAT,
  accountSessionStore,
  type PersistedSession,
  type SessionDocument,
  type SessionStore,
} from "./store.js";
import { loadVersioned, storedVersion, writeVersioned } from "../versioned.js";
import { accountsOf } from "../accounts.js";
import { SealedStateFiles } from "./sealed.js";

const SESSION_FILE = "session.enc";

/**
 * session.enc holds one saved session per account (SessionDocument); an
 * instance reads and writes the entry of one account and keeps the others.
 */
export class FileSessionStore implements SessionStore {
  private readonly entry: SessionStore;

  constructor(
    private readonly dir: string,
    /** The account this store reads and writes (accountKey). */
    readonly account: string,
  ) {
    this.entry = accountSessionStore(
      {
        read: () => this.document(),
        write: (doc) => this.writeDocument(doc),
        remove: () => rmSync(this.blobPath),
      },
      account,
    );
  }

  private get blobPath(): string {
    return join(this.dir, SESSION_FILE);
  }

  private writeDocument(doc: SessionDocument): void {
    // Sealed unbound: session.enc was written before sealed files were bound to their name.
    new SealedStateFiles(this.dir).write(SESSION_FILE, writeVersioned(SESSION_FORMAT, doc), false);
  }

  /** The decrypted document; throws when the blob is corrupt or tampered with. */
  private decrypt(): unknown {
    return new SealedStateFiles(this.dir).read(SESSION_FILE, false);
  }

  /**
   * Every account's session, migrated; null when there is no file or it is
   * unreadable (corrupt, tampered, a malformed version, a session that names
   * no school). A blob from a newer build throws NewerFormatError, so a CLI
   * and an MCP server of different builds sharing this directory never
   * overwrite or delete a newer file: save and clear read it first.
   */
  private document(): SessionDocument | null {
    if (!existsSync(this.blobPath)) return null;
    return loadVersioned<SessionDocument, null>(
      SESSION_FORMAT,
      this.blobPath,
      () => this.decrypt(),
      () => null,
    );
  }

  save(session: PersistedSession): void {
    this.entry.save(session);
  }

  load(): PersistedSession | null {
    return this.entry.load();
  }

  /** Forget this account's session; the file goes with the last one, or when it is unreadable. */
  clear(): void {
    if (existsSync(this.blobPath) && this.document() === null) rmSync(this.blobPath);
    else this.entry.clear();
  }

  /** The keys of every account with a saved session (doctor). */
  accounts(): string[] {
    return Object.keys(accountsOf(this.document()));
  }

  /** The format version on disk (0 before versions existed); null when absent or unreadable. */
  storedVersion(): number | null {
    if (!existsSync(this.blobPath)) return null;
    try {
      return storedVersion(this.decrypt());
    } catch {
      return null;
    }
  }
}
