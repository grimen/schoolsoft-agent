/**
 * E10.4: the local session history and the pending-login marker are sealed
 * with the state directory's key, and the plaintext files of older builds
 * migrate (docs/planning/specs/2026-09-26-privacy-small-fixes.md).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs, { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FilePendingLoginStore,
  FileSessionHistoryStore,
  SessionHistoryRecorder,
  emptyHistory,
} from "../../src/core/index.js";
import { SealedStateFiles } from "../../src/core/session/sealed.js";
import { assertNewer } from "../helpers/versioned.js";
import { openSealed, sealWithStateKey } from "../helpers/sealed.js";

const TABY = "schoolsoft:taby";
const tmp = (prefix: string) => mkdtempSync(join(tmpdir(), `ss-sealed-${prefix}-`));
const record = (dir: string, at = 5) =>
  new SessionHistoryRecorder(new FileSessionHistoryStore(dir, TABY), () => at).record({
    type: "login",
  });

// ---------- the sealed files ----------

test("sealed files: bound to their name, fail on another key, a swap or a missing key", () => {
  const dir = tmp("files");
  const files = new SealedStateFiles(dir);
  files.write("a.enc", { school: "taby" });
  assert.deepEqual(files.read("a.enc"), { school: "taby" });
  assert.deepEqual(openSealed(dir, "a.enc"), { school: "taby" });
  assert.equal(readFileSync(join(dir, "a.enc")).includes(Buffer.from("taby")), false);
  // Another file's sealed bytes do not open under this name.
  writeFileSync(join(dir, "b.enc"), readFileSync(join(dir, "a.enc")));
  assert.throws(() => files.read("b.enc"));
  // Unbound (session.enc, sealed before names were bound) opens only unbound.
  files.write("session.enc", { x: 1 }, false);
  assert.deepEqual(files.read("session.enc", false), { x: 1 });
  assert.throws(() => files.read("session.enc"));
  // The key is created once and shared by every file.
  const key = readFileSync(join(dir, "key.bin"));
  new SealedStateFiles(dir).write("c.enc", 1);
  assert.deepEqual(readFileSync(join(dir, "key.bin")), key);
  fs.rmSync(join(dir, "key.bin"));
  assert.throws(() => files.read("a.enc"));
});

// ---------- session history: session-history.json → session-history.enc ----------

test("history: written sealed as session-history.enc, no plaintext file, nothing readable on disk", () => {
  const dir = tmp("hist-new");
  record(dir);
  assert.equal(existsSync(join(dir, "session-history.json")), false);
  const raw = readFileSync(join(dir, "session-history.enc"));
  assert.equal(raw.includes(Buffer.from("taby")), false);
  assert.equal(raw.includes(Buffer.from("login")), false);
  const doc = openSealed(dir, "session-history.enc") as {
    version: number;
    accounts: Record<string, { app: { startedAt: number } }>;
  };
  assert.equal(doc.version, 2);
  assert.equal(doc.accounts[TABY].app.startedAt, 5);
  assert.equal(new FileSessionHistoryStore(dir, TABY).storedVersion(), 2);
});

for (const [label, content] of [
  ["v0", { ...emptyHistory(), events: [{ type: "login", at: 1 }] }],
  ["v1", { version: 1, ...emptyHistory(), events: [{ type: "login", at: 1 }] }],
  [
    "v2",
    { version: 2, accounts: { [TABY]: { ...emptyHistory(), events: [{ type: "login", at: 1 }] } } },
  ],
] as const) {
  test(`history: a plaintext ${label} file is read, then sealed on the next event and deleted`, () => {
    const dir = tmp(`hist-${label}`);
    const json = join(dir, "session-history.json");
    writeFileSync(json, JSON.stringify(content));
    const store = new FileSessionHistoryStore(dir, TABY);
    assert.equal(store.read()?.events.length, 1);
    assert.equal(store.storedVersion(), label === "v0" ? 0 : Number(label[1]));
    record(dir, 9);
    assert.equal(existsSync(json), false);
    const doc = openSealed(dir, "session-history.enc") as {
      version: number;
      accounts: Record<string, { events: { type: string; at: number }[] }>;
    };
    assert.equal(doc.version, 2);
    assert.deepEqual(
      doc.accounts[TABY].events.map((e) => e.at),
      [1, 9],
    );
    assert.equal(store.storedVersion(), 2);
  });
}

test("history: the plaintext file stays when sealing fails", (t) => {
  const dir = tmp("hist-fail");
  const json = join(dir, "session-history.json");
  const original = JSON.stringify({ version: 2, accounts: {} });
  writeFileSync(json, original);
  t.mock.method(fs, "renameSync", () => {
    throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
  });
  syncBuiltinESMExports();
  try {
    const store = new FileSessionHistoryStore(dir, TABY);
    assert.throws(() => store.write(emptyHistory()), /disk full/);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
  assert.equal(readFileSync(json, "utf8"), original);
  assert.equal(existsSync(join(dir, "session-history.enc")), false);
});

test("history: a newer plaintext file is refused and left alone; nothing is sealed over it", () => {
  const dir = tmp("hist-newer-json");
  const json = join(dir, "session-history.json");
  const original = JSON.stringify({ version: 3, accounts: {} });
  writeFileSync(json, original);
  const store = new FileSessionHistoryStore(dir, TABY);
  assert.throws(
    () => store.read(),
    (e) => assertNewer(e, json),
  );
  record(dir);
  assert.equal(readFileSync(json, "utf8"), original);
  assert.equal(existsSync(join(dir, "session-history.enc")), false);
  assert.equal(store.storedVersion(), 3);
});

test("history: a newer sealed file is refused and left byte for byte", () => {
  const dir = tmp("hist-newer-enc");
  record(dir);
  const enc = join(dir, "session-history.enc");
  const blob = sealWithStateKey(dir, "session-history.enc", { version: 3, accounts: {} });
  const store = new FileSessionHistoryStore(dir, TABY);
  assert.throws(
    () => store.read(),
    (e) => assertNewer(e, enc),
  );
  record(dir);
  assert.deepEqual(readFileSync(enc), blob);
  assert.equal(store.storedVersion(), 3);
});

test("history: the sealed file wins over a plaintext one an older build wrote next to it, which the next event deletes", () => {
  const dir = tmp("hist-both");
  record(dir, 5);
  const json = join(dir, "session-history.json");
  writeFileSync(json, JSON.stringify({ version: 2, accounts: { [TABY]: emptyHistory() } }));
  const store = new FileSessionHistoryStore(dir, TABY);
  assert.equal(store.read()?.app?.startedAt, 5);
  record(dir, 7);
  assert.equal(existsSync(json), false);
  assert.equal(store.read()?.app?.startedAt, 7);
});

test("history: an unreadable sealed file (tampered, or the key is gone) reads as empty and is replaced", () => {
  const dir = tmp("hist-corrupt");
  record(dir, 5);
  const enc = join(dir, "session-history.enc");
  const raw = readFileSync(enc);
  raw[raw.length - 1] ^= 0xff;
  writeFileSync(enc, raw);
  const store = new FileSessionHistoryStore(dir, TABY);
  assert.equal(store.read(), null);
  assert.equal(store.storedVersion(), null);
  record(dir, 6);
  assert.equal(store.read()?.app?.startedAt, 6);
});

// ---------- pending-login marker: login-pending.json → login-pending.enc ----------

test("pending marker: sealed as login-pending.enc; the URL and failure text are not readable on disk", () => {
  const dir = join(tmp("pending"), "state");
  const store = new FilePendingLoginStore(dir);
  assert.equal(store.read(), null);
  store.write({
    state: "failed",
    startedAt: 1,
    pid: 7,
    url: "https://sms.schoolsoft.se/taby/login",
    error: "BankID was cancelled",
  });
  const raw = readFileSync(join(dir, "login-pending.enc"));
  for (const secret of ["schoolsoft", "taby", "BankID"])
    assert.equal(raw.includes(Buffer.from(secret)), false, secret);
  assert.equal(openSealed(dir, "login-pending.enc").url, "https://sms.schoolsoft.se/taby/login");
  assert.equal(store.read()?.error, "BankID was cancelled");
  writeFileSync(join(dir, "login-pending.enc"), "garbage");
  assert.equal(store.read(), null);
  store.clear();
  assert.equal(existsSync(join(dir, "login-pending.enc")), false);
  store.clear();
});

test("pending marker: a plaintext marker left by an older build is ignored, and removed on the next write or clear", () => {
  const dir = tmp("pending-legacy");
  mkdirSync(dir, { recursive: true });
  const legacy = join(dir, "login-pending.json");
  const plain = JSON.stringify({ state: "running", startedAt: 1, pid: 7, url: "https://x/" });
  writeFileSync(legacy, plain);
  const store = new FilePendingLoginStore(dir);
  assert.equal(store.read(), null);
  store.write({ state: "running", startedAt: 2, pid: 8 });
  assert.equal(existsSync(legacy), false);
  writeFileSync(legacy, plain);
  store.clear();
  assert.equal(existsSync(legacy), false);
});
