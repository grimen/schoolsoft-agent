/** Authenticated encrypted atomic disk persistence. The encryption key lives outside this disk. */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  unlinkSync,
  openSync,
  fsyncSync,
  closeSync,
} from "node:fs";
import { join } from "node:path";
import { InputError } from "../core/index.js";
export class EncryptedRepository<T> {
  private path: string;
  constructor(
    private directory: string,
    name: string,
    private key: Buffer,
  ) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.path = join(directory, name + ".enc");
  }
  read(): T | undefined {
    let data: Buffer;
    try {
      data = readFileSync(this.path);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw e;
    }
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.key, data.subarray(0, 12));
      decipher.setAAD(Buffer.from(this.path.split("/").pop()!));
      decipher.setAuthTag(data.subarray(12, 28));
      return JSON.parse(
        Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString(),
      ) as T;
    } catch {
      throw new InputError(
        "Stored connector data cannot be read. Restore the matching encryption key and disk backup.",
      );
    }
  }
  write(value: T): void {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(this.path.split("/").pop()!));
    const body = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    const temporary = this.path + ".tmp";
    writeFileSync(temporary, Buffer.concat([iv, cipher.getAuthTag(), body]), {
      mode: 0o600,
      flush: true,
    });
    renameSync(temporary, this.path);
    this.syncDirectory();
  }
  private syncDirectory(): void {
    const fd = openSync(this.directory, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }
  clear(): void {
    try {
      unlinkSync(this.path);
      this.syncDirectory();
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
}
