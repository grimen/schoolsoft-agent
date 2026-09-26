/**
 * File-backed SessionStore: AES-256-GCM blob under the state directory,
 * key generated on first use and stored with 0600 permissions.
 *
 * Protects against casual file exposure (backups, sync folders), not
 * against an attacker with full access to the same user account. For
 * stronger protection, implement SessionStore against an OS keychain.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
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

  private ensureDir(): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
  }

  private get keyPath(): string {
    return join(this.dir, "key.bin");
  }

  private get blobPath(): string {
    return join(this.dir, "session.enc");
  }

  private loadOrCreateKey(): Buffer {
    this.ensureDir();
    if (existsSync(this.keyPath)) {
      return readFileSync(this.keyPath);
    }
    const key = randomBytes(32);
    writeFileSync(this.keyPath, key, { mode: 0o600 });
    return key;
  }

  private writeDocument(doc: SessionDocument): void {
    const key = this.loadOrCreateKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const plaintext = Buffer.from(JSON.stringify(writeVersioned(SESSION_FORMAT, doc)), "utf8");
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    writeFileSync(this.blobPath, Buffer.concat([iv, tag, encrypted]), {
      mode: 0o600,
    });
  }

  /** The decrypted document; throws when the blob is corrupt or tampered with. */
  private decrypt(): unknown {
    const key = this.loadOrCreateKey();
    const data = readFileSync(this.blobPath);
    const iv = data.subarray(0, 12);
    const tag = data.subarray(12, 28);
    const encrypted = data.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return JSON.parse(plaintext.toString("utf8"));
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
