/**
 * The one helper every state and config write goes through: 0700
 * directories, 0600 files, whole-file replacement, exclusive creation for
 * the key, durable writes for the connector. The sweep over every real
 * writer is test/unit/file-modes.test.ts; the import rule is
 * test/boundary/file-writes.test.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendPrivateFile,
  createPrivateFile,
  ensurePrivateDir,
  syncDirectory,
  writePrivateFile,
} from "../../src/core/private-files.js";

const mode = (p: string) => statSync(p).mode & 0o777;
const posix = process.platform !== "win32";

test("directories are created 0700, every missing level of them", { skip: !posix }, () => {
  const root = mkdtempSync(join(tmpdir(), "private-"));
  ensurePrivateDir(join(root, "a", "b"));
  assert.equal(mode(join(root, "a")), 0o700);
  assert.equal(mode(join(root, "a", "b")), 0o700);
  ensurePrivateDir(join(root, "a", "b")); // exists: no error
});

test("a file is written 0600 into a new 0700 directory, whole, with no temporary left", () => {
  const root = mkdtempSync(join(tmpdir(), "private-"));
  const file = join(root, "config", "schools.json");
  writePrivateFile(file, "first");
  assert.equal(readFileSync(file, "utf8"), "first");
  writePrivateFile(file, Buffer.from("second"));
  assert.equal(readFileSync(file, "utf8"), "second");
  assert.deepEqual(readdirSync(join(root, "config")), ["schools.json"]);
  if (posix) {
    assert.equal(mode(file), 0o600);
    assert.equal(mode(join(root, "config")), 0o700);
  }
});

test(
  "a file created earlier with wider permissions is replaced, not reused",
  { skip: !posix },
  () => {
    const root = mkdtempSync(join(tmpdir(), "private-"));
    const file = join(root, "schools.json");
    writeFileSync(file, "old", { mode: 0o644 });
    chmodSync(file, 0o644);
    writePrivateFile(file, "new");
    assert.equal(mode(file), 0o600);
  },
);

test("a stale temporary file from a crashed write is replaced; a failed rename leaves no temporary", () => {
  const root = mkdtempSync(join(tmpdir(), "private-"));
  const file = join(root, "state.json");
  writeFileSync(`${file}.${process.pid}.tmp`, "stale", { mode: 0o644 });
  writePrivateFile(file, "fresh");
  assert.equal(readFileSync(file, "utf8"), "fresh");
  assert.deepEqual(readdirSync(root), ["state.json"]);
  // The target is a non-empty directory: the rename fails, the error reaches the caller.
  const blocked = join(root, "blocked");
  mkdirSync(blocked);
  writeFileSync(join(blocked, "inside"), "x");
  assert.throws(() => writePrivateFile(blocked, "data"));
  assert.deepEqual(readdirSync(root).sort(), ["blocked", "state.json"]);
});

test("durable writes flush and then sync the directory", () => {
  const root = mkdtempSync(join(tmpdir(), "private-"));
  const file = join(root, "oauth.enc");
  writePrivateFile(file, "sealed", { durable: true });
  assert.equal(readFileSync(file, "utf8"), "sealed");
  syncDirectory(root);
});

test("exclusive creation: the first writer's content wins, a second call reports it existed", () => {
  const root = mkdtempSync(join(tmpdir(), "private-"));
  const file = join(root, "state", "key.bin");
  assert.equal(createPrivateFile(file, Buffer.from("one")), true);
  assert.equal(createPrivateFile(file, Buffer.from("two")), false);
  assert.equal(readFileSync(file, "utf8"), "one");
  if (posix) assert.equal(mode(file), 0o600);
  // Anything but "already exists" is the caller's problem.
  assert.throws(() => createPrivateFile(join(root, "x".repeat(300)), "x"), /ENAMETOOLONG/);
});

test("appends create the file 0600 in a 0700 directory and add to it", () => {
  const root = mkdtempSync(join(tmpdir(), "private-"));
  const file = join(root, "logs", "probe.jsonl");
  appendPrivateFile(file, "a\n");
  appendPrivateFile(file, "b\n");
  assert.equal(readFileSync(file, "utf8"), "a\nb\n");
  assert.ok(existsSync(file));
  if (posix) {
    assert.equal(mode(file), 0o600);
    assert.equal(mode(join(root, "logs")), 0o700);
  }
});
