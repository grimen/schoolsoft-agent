/**
 * Independent reader and writer for the files sealed with the state
 * directory's key.bin (session-history.enc, login-pending.enc): AES-256-GCM,
 * iv | tag | ciphertext, the file name as associated data. Written against
 * the documented layout, not the production code, so a test can tell a
 * sealed file from what the code under test believes it wrote.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function openSealed(dir: string, name: string): Record<string, unknown> {
  const key = readFileSync(join(dir, "key.bin"));
  const data = readFileSync(join(dir, name));
  const d = createDecipheriv("aes-256-gcm", key, data.subarray(0, 12));
  d.setAAD(Buffer.from(name));
  d.setAuthTag(data.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(data.subarray(28)), d.final()]).toString("utf8"));
}

/** Seal `doc` into `dir/name` with the existing key.bin; returns the bytes written. */
export function sealWithStateKey(dir: string, name: string, doc: unknown): Buffer {
  const key = readFileSync(join(dir, "key.bin"));
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(name));
  const body = Buffer.concat([c.update(JSON.stringify(doc)), c.final()]);
  const blob = Buffer.concat([iv, c.getAuthTag(), body]);
  writeFileSync(join(dir, name), blob);
  return blob;
}
