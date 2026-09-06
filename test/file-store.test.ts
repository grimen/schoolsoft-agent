import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileSessionStore } from "../src/services/file-store.js";
import type { PersistedSession } from "../src/services/store.js";

function tmpStore(): { store: FileSessionStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "ssmcp-test-"));
  return { store: new FileSessionStore(dir), dir };
}

const sample: PersistedSession = {
  school: "testskola",
  accessToken: "secret-token",
  refreshToken: "secret-refresh",
  savedAt: 1_700_000_000_000,
  authMethod: "bankid-browser",
};

test("save/load roundtrip preserves all fields", () => {
  const { store } = tmpStore();
  store.save(sample);
  assert.deepEqual(store.load(), sample);
});

test("load returns null when nothing saved", () => {
  const { store } = tmpStore();
  assert.equal(store.load(), null);
});

test("clear removes the session; key survives", () => {
  const { store, dir } = tmpStore();
  store.save(sample);
  store.clear();
  assert.equal(store.load(), null);
  assert.ok(readFileSync(join(dir, "key.bin")).length === 32);
});

test("blob on disk is actually encrypted (no plaintext token)", () => {
  const { store, dir } = tmpStore();
  store.save(sample);
  const raw = readFileSync(join(dir, "session.enc"));
  assert.ok(!raw.includes(Buffer.from("secret-token")));
  assert.ok(!raw.includes(Buffer.from("testskola")));
});

test("corrupt blob is treated as logged out, not a crash", () => {
  const { store, dir } = tmpStore();
  store.save(sample);
  const p = join(dir, "session.enc");
  const raw = readFileSync(p);
  raw[raw.length - 1] ^= 0xff; // flip a ciphertext bit → GCM auth fails
  writeFileSync(p, raw);
  assert.equal(store.load(), null);
});

test("tampered IV/tag also fails closed", () => {
  const { store, dir } = tmpStore();
  store.save(sample);
  const p = join(dir, "session.enc");
  const raw = readFileSync(p);
  raw[0] ^= 0xff; // flip an IV bit
  writeFileSync(p, raw);
  assert.equal(store.load(), null);
});

test("key and blob have owner-only permissions", () => {
  const { store, dir } = tmpStore();
  store.save(sample);
  for (const f of ["key.bin", "session.enc"]) {
    const mode = statSync(join(dir, f)).mode & 0o777;
    assert.equal(mode, 0o600, `${f} should be 0600, was ${mode.toString(8)}`);
  }
});
