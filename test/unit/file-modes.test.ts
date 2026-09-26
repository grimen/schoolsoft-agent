/**
 * Every writer of config, state, cache and log files, run against empty
 * directories: everything it creates is a 0700 directory or a 0600 file.
 * A new writer belongs here; the boundary rule (test/boundary/file-writes.test.ts)
 * already refuses one that does not go through src/core/private-files.ts.
 * POSIX only: on Windows the modes are ignored and the profile's permissions apply.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
  FilePendingLoginStore,
  FileSessionHistoryStore,
  FileSessionStore,
  HISTORY_FORMAT,
  SessionHistoryRecorder,
} from "../../src/core/index.js";
import { writeConfigFile } from "../../src/shared/bootstrap.js";
import { SchoolDirectory } from "../../src/providers/schoolsoft/schools.js";
import { EncryptedRepository } from "../../src/http/storage.js";
import { fileLog } from "../../src/http/probe/log.js";
import { runDoctor } from "../../src/cli/commands/doctor.js";

const posix = process.platform !== "win32";

/** Every path below `root` whose mode is not private, as "path mode". */
function wider(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      const stat = statSync(path);
      const expected = stat.isDirectory() ? 0o700 : 0o600;
      if ((stat.mode & 0o777) !== expected)
        out.push(`${relative(root, path)} ${(stat.mode & 0o777).toString(8)}`);
      if (stat.isDirectory()) walk(path);
    }
  };
  walk(root);
  return out;
}

/** Each writer creates its directory itself: one level (or two) below the empty root. */
const writers: Record<string, (root: string) => Promise<void> | void> = {
  "config.json": (root) => void writeConfigFile(join(root, "config"), { school: "taby" }),
  "schools.json, creating the config directory": async (root) => {
    const directory = new SchoolDirectory({
      cacheFile: join(root, "config", "schools.json"),
      fetchImpl: async () => [
        { name: "Rösjöskolan", orgId: 20, evaUrl: "https://sms.schoolsoft.se/taby/eva" },
      ],
    });
    await directory.list();
  },
  "session.enc and key.bin": (root) =>
    new FileSessionStore(join(root, "config", "state"), "schoolsoft:taby").save({
      provider: "schoolsoft",
      school: "taby",
      data: { accessToken: "a" },
      savedAt: 1,
      authMethod: "bankid-browser",
    }),
  "session-history.enc": (root) =>
    new SessionHistoryRecorder(
      new FileSessionHistoryStore(join(root, "state"), "schoolsoft:taby"),
      () => 1,
    ).record({ type: "login" }),
  "login-pending.enc": (root) =>
    new FilePendingLoginStore(join(root, "state")).write({ state: "running", startedAt: 1 }),
  "connector .enc files": (root) =>
    new EncryptedRepository(join(root, "data"), "history", Buffer.alloc(32), HISTORY_FORMAT).write({
      accounts: {},
    }),
  "host probe log": (root) =>
    fileLog(join(root, "probe", "events.jsonl"), { surface: "stdio", echo: () => {} }).record({
      event: "start",
    }),
  "doctor --fix, creating the state directory": async (root) => {
    const legacy = join(root, ".schoolsoft-mcp");
    new FileSessionStore(legacy, "schoolsoft:taby").save({
      provider: "schoolsoft",
      school: "taby",
      data: { accessToken: "a" },
      savedAt: 1,
      authMethod: "bankid-browser",
    });
    const result = await runDoctor(
      {
        getContext: () => {
          throw new Error("doctor never builds a context");
        },
        stdout: () => {},
        stderr: () => {},
        env: {},
        home: root,
        platform: "linux",
        version: "0",
        fetchImpl: async () => ({ status: 200 }),
        browserProbes: {
          resolvePlaywright: () => {
            throw new Error("not installed");
          },
          chromiumPath: async () => "/nowhere/chromium",
        },
      },
      { school: "taby", configDir: join(root, "config"), stateDir: join(root, "state") },
      true,
      "v22.0.0",
    );
    assert.ok(result.checks.some((c) => c.name === "migration" && c.ok));
  },
};

for (const [name, write] of Object.entries(writers)) {
  test(`${name}: only 0700 directories and 0600 files`, { skip: !posix }, async () => {
    const root = mkdtempSync(join(tmpdir(), "file-modes-"));
    await write(root);
    assert.notDeepEqual(readdirSync(root), [], "the writer created something");
    assert.deepEqual(wider(root), []);
  });
}
