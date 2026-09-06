import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileSessionStore } from "../../src/core/session/file-store.js";
import type { PersistedSession } from "../../src/core/session/store.js";

function tmpStore(): { store: FileSessionStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "ssmcp-test-"));
  return { store: new FileSessionStore(dir), dir };
}

const sample: PersistedSession = {
  provider: "schoolsoft",
  school: "testskola",
  data: { accessToken: "secret-token", refreshToken: "secret-refresh" },
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

test("a blob written before the provider seam is migrated: SchoolSoft's top-level fields become data", async () => {
  const { migratePersisted } = await import("../../src/core/session/store.js");
  const legacy = {
    school: "testskola",
    accessToken: "a",
    refreshToken: "r",
    accessTokenExpiresAt: 5,
    guardian: { userId: 1, parentName: "P", children: [], childInFocus: 1 },
    savedAt: 2,
    authMethod: "bankid-browser",
  };
  const migrated = migratePersisted(legacy);
  assert.deepEqual(migrated.data, { accessToken: "a", refreshToken: "r", accessTokenExpiresAt: 5 });
  assert.equal(
    migrated.provider,
    undefined,
    "provider unknown for legacy files; the manager accepts them",
  );
  assert.equal(migrated.guardian?.userId, 1);
  assert.deepEqual(
    migratePersisted(sample as never),
    sample,
    "already migrated blobs pass through",
  );
  const { store } = tmpStore();
  const { writeFileSync: w, readFileSync: r } = await import("node:fs");
  const { createCipheriv, randomBytes } = await import("node:crypto");
  // write a legacy-shaped blob with the store's own key
  store.save(sample);
  const dir = (store as unknown as { dir: string }).dir;
  const key = r(dir + "/key.bin");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(legacy))), cipher.final()]);
  w(dir + "/session.enc", Buffer.concat([iv, cipher.getAuthTag(), enc]));
  assert.deepEqual(store.load()?.data, {
    accessToken: "a",
    refreshToken: "r",
    accessTokenExpiresAt: 5,
  });
});
