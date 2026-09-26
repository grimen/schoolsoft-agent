/**
 * Files sealed with the local state directory's key (`key.bin`, 32 random
 * bytes, created on first use): AES-256-GCM, stored as iv | tag | ciphertext.
 * `session.enc`, `session-history.enc` and `login-pending.enc` use it. A file
 * is bound to its name (the name is the associated data), so one sealed file
 * cannot be passed off as another; `session.enc` predates that and is sealed
 * unbound.
 *
 * Protects against casual exposure of a single file (backups, sync folders),
 * not against someone who can read the whole state directory, where the key
 * sits next to the files. For stronger protection, implement the stores
 * against an OS keychain.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createPrivateFile, writePrivateFile } from "../private-files.js";

export const STATE_KEY_FILE = "key.bin";

export class SealedStateFiles {
  constructor(private readonly dir: string) {}

  /** The directory's key; created (exclusively, 0600) when there is none yet. */
  private key(): Buffer {
    const path = join(this.dir, STATE_KEY_FILE);
    createPrivateFile(path, randomBytes(32));
    return readFileSync(path);
  }

  /** Seal `value` as JSON into `name` (0600, replaced whole). */
  write(name: string, value: unknown, bound = true): void {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key(), iv);
    if (bound) cipher.setAAD(Buffer.from(name));
    const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
    writePrivateFile(join(this.dir, name), Buffer.concat([iv, cipher.getAuthTag(), body]));
  }

  /** The parsed contents of `name`; throws when it is missing, tampered with or sealed with another key. */
  read(name: string, bound = true): unknown {
    const data = readFileSync(join(this.dir, name));
    const decipher = createDecipheriv("aes-256-gcm", this.key(), data.subarray(0, 12));
    if (bound) decipher.setAAD(Buffer.from(name));
    decipher.setAuthTag(data.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8"),
    );
  }
}
