import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EncryptedRepository } from "../../src/http/storage.js";
test("security state flushes file before rename and directory before acknowledging writes/deletion", (t) => {
  const dir = fs.mkdtempSync(join(tmpdir(), "connector-durability-"));
  const events: string[] = [];
  const write = fs.writeFileSync,
    rename = fs.renameSync,
    sync = fs.fsyncSync,
    remove = fs.unlinkSync;
  t.mock.method(fs, "writeFileSync", (...args: Parameters<typeof fs.writeFileSync>) => {
    assert.equal((args[2] as { flush: boolean }).flush, true);
    events.push("write");
    return write(...args);
  });
  t.mock.method(fs, "renameSync", (...args: Parameters<typeof fs.renameSync>) => {
    events.push("rename");
    return rename(...args);
  });
  t.mock.method(fs, "fsyncSync", (fd: number) => {
    events.push(fs.fstatSync(fd).isDirectory() ? "directory-sync" : "file-sync");
    return sync(fd);
  });
  t.mock.method(fs, "unlinkSync", (...args: Parameters<typeof fs.unlinkSync>) => {
    events.push("unlink");
    return remove(...args);
  });
  syncBuiltinESMExports();
  try {
    const repo = new EncryptedRepository(dir, "state", Buffer.alloc(32));
    repo.write({ revoked: true });
    assert.equal(events[0], "write");
    assert.ok(events.includes("directory-sync"));
    assert.ok(events.indexOf("rename") < events.indexOf("directory-sync"));
    events.length = 0;
    repo.clear();
    assert.deepEqual(events, ["unlink", "directory-sync"]);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
