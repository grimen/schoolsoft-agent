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
import type { PersistedSession, SessionStore } from "./store.js";

export class FileSessionStore implements SessionStore {
  constructor(private readonly dir: string) {}

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

  save(session: PersistedSession): void {
    const key = this.loadOrCreateKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const plaintext = Buffer.from(JSON.stringify(session), "utf8");
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    writeFileSync(this.blobPath, Buffer.concat([iv, tag, encrypted]), {
      mode: 0o600,
    });
  }

  load(): PersistedSession | null {
    if (!existsSync(this.blobPath)) return null;
    try {
      const key = this.loadOrCreateKey();
      const data = readFileSync(this.blobPath);
      const iv = data.subarray(0, 12);
      const tag = data.subarray(12, 28);
      const encrypted = data.subarray(28);
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);
      return JSON.parse(plaintext.toString("utf8")) as PersistedSession;
    } catch {
      // Corrupt or tampered blob — treat as logged out.
      return null;
    }
  }

  clear(): void {
    if (existsSync(this.blobPath)) rmSync(this.blobPath);
  }
}
