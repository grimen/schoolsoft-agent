/**
 * Versioned state and config (docs/planning/specs/2026-09-26-versioned-state.md):
 * for every persisted file kind, a v0 file loads and is rewritten with a
 * version, the current version loads, a newer version fails with a
 * user-facing error in both languages and leaves the file byte-for-byte
 * as it was, and a malformed version takes the file's corrupted-file path.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONFIG_FORMAT,
  FileSessionHistoryStore,
  FileSessionStore,
  HISTORY_FORMAT,
  MalformedVersionError,
  NewerFormatError,
  SESSION_FORMAT,
  SessionHistoryRecorder,
  currentVersion,
  describeVersion,
  emptyHistory,
  loadVersioned,
  readVersioned,
  storedVersion,
  unchanged,
  writeVersioned,
  type ConfigSource,
  type PersistedSession,
  type VersionedFormat,
} from "../../src/core/index.js";
import {
  configFileVersion,
  fileSource,
  loadConfig,
  readConfigFile,
  writeConfigFile,
} from "../../src/shared/bootstrap.js";
import { runCli, type CliDeps } from "../../src/cli/program.js";
import { runDoctor } from "../../src/cli/commands/doctor.js";
import { assertNewer } from "../helpers/versioned.js";

const tmp = (prefix: string) => mkdtempSync(join(tmpdir(), `ss-versioned-${prefix}-`));

// ---------- the helper ----------

test("helper: storedVersion reads the field, treats a missing one as v0 and flags malformed ones", () => {
  assert.equal(storedVersion({ school: "x" }), 0);
  assert.equal(storedVersion("bare string"), 0);
  assert.equal(storedVersion(null), 0);
  assert.equal(storedVersion([1]), 0);
  assert.equal(storedVersion({ version: 0 }), 0);
  assert.equal(storedVersion({ version: 3 }), 3);
  for (const bad of ["1", -1, 1.5, null, true, {}]) {
    assert.equal(storedVersion({ version: bad }), null, JSON.stringify(bad));
  }
});

test("helper: readVersioned runs every step from the stored version, strips the field, refuses newer and malformed", () => {
  const steps: string[] = [];
  const format: VersionedFormat = {
    migrations: [
      (doc: { a: number }) => (steps.push("0→1"), { b: doc.a }),
      (doc: { b: number }) => (steps.push("1→2"), { c: doc.b, version: 2 }),
    ],
  };
  assert.equal(currentVersion(format), 2);
  assert.deepEqual(readVersioned(format, { a: 1 }, "f"), { c: 1 });
  assert.deepEqual(steps, ["0→1", "1→2"]);
  steps.length = 0;
  assert.deepEqual(readVersioned(format, { version: 1, b: 7 }, "f"), { c: 7 });
  assert.deepEqual(steps, ["1→2"]);
  steps.length = 0;
  assert.deepEqual(readVersioned(format, { version: 2, c: 9 }, "f"), { c: 9 });
  assert.deepEqual(steps, []);
  assert.throws(
    () => readVersioned(format, { version: 3 }, "/x/file.json"),
    (e) => assertNewer(e, "/x/file.json"),
  );
  assert.throws(() => readVersioned(format, { version: "2" }, "f"), MalformedVersionError);
  assert.throws(
    () => readVersioned(format, { version: "2" }, "f"),
    /"version" is not a whole number/,
  );
});

test("helper: loadVersioned hands every failure but a newer version to the corrupted-file path", () => {
  const format: VersionedFormat = { migrations: [unchanged] };
  const seen: unknown[] = [];
  const corrupt = (e: unknown) => (seen.push(e), "corrupt" as const);
  assert.deepEqual(
    loadVersioned(format, "f", () => ({ version: 1, a: 1 }), corrupt),
    { a: 1 },
  );
  assert.equal(
    loadVersioned(
      format,
      "f",
      () => {
        throw new SyntaxError("bad json");
      },
      corrupt,
    ),
    "corrupt",
  );
  assert.equal(
    loadVersioned(format, "f", () => ({ version: -1 }), corrupt),
    "corrupt",
  );
  assert.ok(seen[0] instanceof SyntaxError);
  assert.ok(seen[1] instanceof MalformedVersionError);
  assert.throws(
    () => loadVersioned(format, "f", () => ({ version: 2 }), corrupt),
    NewerFormatError,
  );
  assert.equal(seen.length, 2);
});

test("helper: writeVersioned puts the current version first and replaces a stale one", () => {
  const format: VersionedFormat = { migrations: [unchanged, unchanged] };
  const written = writeVersioned(format, { version: 1, a: 1 });
  assert.deepEqual(written, { version: 2, a: 1 });
  assert.deepEqual(Object.keys(written), ["version", "a"]);
});

test("helper: describeVersion for doctor", () => {
  const format: VersionedFormat = { migrations: [unchanged] };
  assert.equal(describeVersion(format, null), "format version unreadable");
  assert.equal(describeVersion(format, 1), "format v1");
  assert.equal(describeVersion(format, 0), "format v0, upgraded to v1 on the next write");
  assert.equal(describeVersion(format, 2), "format v2, newer than this version reads (v1)");
});

// ---------- config.json ----------

function cli(env: Record<string, string> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const deps: CliDeps = {
    getContext: () => {
      throw new Error("not used");
    },
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    env,
    home: tmp("home"),
    platform: "linux",
    version: "9.9.9",
    fetchImpl: async () => ({ status: 200 }),
  };
  return async (...argv: string[]) => {
    out.length = 0;
    err.length = 0;
    const code = await runCli(argv, deps);
    return { code, err: err.join("\n") };
  };
}

test("config.json v0: loads unchanged, and the next configure writes version 1 with everything kept", async () => {
  const dir = tmp("cfg0");
  const file = join(dir, "config.json");
  writeFileSync(file, JSON.stringify({ school: "taby", keepalive: "app" }));
  assert.deepEqual(fileSource(dir), { school: "taby", keepalive: "app", configDir: dir });
  assert.deepEqual(readConfigFile(dir), { school: "taby", keepalive: "app" });
  assert.equal(configFileVersion(dir), 0);
  assert.equal(
    loadConfig({ env: {}, home: dir, platform: "linux", overrides: { configDir: dir } }).school,
    "taby",
  );
  const run = cli();
  const r = await run("--config-dir", dir, "--school", "rosjo", "configure");
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), {
    version: 1,
    school: "rosjo",
    keepalive: "app",
  });
  assert.equal(configFileVersion(dir), 1);
});

test("config.json v1: loads without the field", () => {
  const dir = tmp("cfg1");
  writeConfigFile(dir, { school: "taby", orgId: "20" } satisfies ConfigSource);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "config.json"), "utf8")), {
    version: 1,
    school: "taby",
    orgId: "20",
  });
  assert.deepEqual(readConfigFile(dir), { school: "taby", orgId: "20" });
  assert.deepEqual(fileSource(dir), { school: "taby", orgId: "20", configDir: dir });
  assert.equal(currentVersion(CONFIG_FORMAT), 1);
});

test("config.json from a newer build: every reader refuses, configure exits 5 in both languages, the file is untouched", async () => {
  const dir = tmp("cfg2");
  const file = join(dir, "config.json");
  const original = JSON.stringify({ version: 2, school: "taby", accounts: [] });
  writeFileSync(file, original);
  assert.throws(
    () => fileSource(dir),
    (e) => assertNewer(e, file),
  );
  assert.throws(
    () => readConfigFile(dir),
    (e) => assertNewer(e, file),
  );
  assert.equal(configFileVersion(dir), 2);
  const en = await cli()("--config-dir", dir, "--school", "rosjo", "configure");
  assert.equal(en.code, 5);
  assert.match(en.err, /written by a newer version of schoolsoft-agent/);
  assert.match(en.err, /Next: Update schoolsoft-agent/);
  const sv = await cli({ SCHOOLSOFT_LANG: "sv" })(
    "--config-dir",
    dir,
    "--school",
    "rosjo",
    "configure",
  );
  assert.equal(sv.code, 5);
  assert.match(sv.err, /skrevs av en nyare version/);
  assert.equal(readFileSync(file, "utf8"), original);
});

test("config.json with a malformed version is the usual parse error naming the file", () => {
  const dir = tmp("cfgbad");
  writeFileSync(join(dir, "config.json"), JSON.stringify({ version: "one", school: "taby" }));
  assert.throws(
    () => fileSource(dir),
    /Could not parse .*config\.json: .*"version" is not a whole number/,
  );
  assert.throws(() => readConfigFile(dir), /Could not parse/);
  assert.equal(configFileVersion(dir), null);
  writeFileSync(join(dir, "config.json"), "{oops");
  assert.equal(configFileVersion(dir), null);
  assert.equal(configFileVersion(tmp("cfgnone")), null);
});

// ---------- local session.enc ----------

const session: PersistedSession = {
  provider: "schoolsoft",
  school: "testskola",
  data: { accessToken: "a", refreshToken: "r" },
  savedAt: 1,
  authMethod: "bankid-browser",
};

function sealLocal(dir: string, doc: unknown): Buffer {
  const key = readFileSync(join(dir, "key.bin"));
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(doc)), cipher.final()]);
  const blob = Buffer.concat([iv, cipher.getAuthTag(), body]);
  writeFileSync(join(dir, "session.enc"), blob);
  return blob;
}

function openLocal(dir: string): Record<string, unknown> {
  const key = readFileSync(join(dir, "key.bin"));
  const data = readFileSync(join(dir, "session.enc"));
  const d = createDecipheriv("aes-256-gcm", key, data.subarray(0, 12));
  d.setAuthTag(data.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(data.subarray(28)), d.final()]).toString());
}

test("session.enc v0 (both unversioned shapes): loads, and the next save writes version 1", () => {
  const dir = tmp("sess0");
  const store = new FileSessionStore(dir);
  assert.equal(store.storedVersion(), null);
  store.save(session);
  sealLocal(dir, { ...session });
  assert.equal(store.storedVersion(), 0);
  assert.deepEqual(store.load(), session);
  // The pre-provider-seam shape is v0 too: migratePersisted is its migration.
  sealLocal(dir, {
    school: "testskola",
    accessToken: "a",
    savedAt: 1,
    authMethod: "bankid-browser",
  });
  assert.deepEqual(store.load()?.data, { accessToken: "a" });
  store.save(store.load()!);
  assert.equal(openLocal(dir).version, 1);
  assert.equal(store.storedVersion(), 1);
  assert.equal(currentVersion(SESSION_FORMAT), 1);
});

test("session.enc v1: loads without the field", () => {
  const dir = tmp("sess1");
  const store = new FileSessionStore(dir);
  store.save(session);
  assert.deepEqual(Object.keys(openLocal(dir))[0], "version");
  assert.deepEqual(store.load(), session);
});

test("session.enc from a newer build: load, save and clear refuse; the blob is untouched", () => {
  const dir = tmp("sess2");
  const store = new FileSessionStore(dir);
  store.save(session);
  const blob = sealLocal(dir, { ...session, version: 2 });
  const file = join(dir, "session.enc");
  assert.throws(
    () => store.load(),
    (e) => assertNewer(e, file),
  );
  assert.throws(
    () => store.save(session),
    (e) => assertNewer(e, file),
  );
  assert.throws(
    () => store.clear(),
    (e) => assertNewer(e, file),
  );
  assert.equal(store.storedVersion(), 2);
  assert.deepEqual(readFileSync(file), blob);
});

test("session.enc with a malformed version reads as logged out, like a corrupt blob, and can be replaced", () => {
  const dir = tmp("sessbad");
  const store = new FileSessionStore(dir);
  store.save(session);
  sealLocal(dir, { ...session, version: "x" });
  assert.equal(store.load(), null);
  assert.equal(store.storedVersion(), null);
  store.save(session);
  assert.deepEqual(store.load(), session);
  writeFileSync(join(dir, "session.enc"), Buffer.from("garbage-that-is-not-a-blob-at-all"));
  assert.equal(store.storedVersion(), null);
  store.clear();
  assert.equal(existsSync(join(dir, "session.enc")), false);
});

// ---------- local session-history.json ----------

test("session-history.json v0 loads and the next event writes version 1; v1 loads", () => {
  const dir = tmp("hist0");
  const store = new FileSessionHistoryStore(dir);
  const file = join(dir, "session-history.json");
  assert.equal(store.storedVersion(), null);
  writeFileSync(file, JSON.stringify(emptyHistory()));
  assert.equal(store.storedVersion(), 0);
  assert.deepEqual(store.read(), emptyHistory());
  new SessionHistoryRecorder(store, () => 5).record({ type: "login" });
  const written = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(written.version, 1);
  assert.equal(store.storedVersion(), 1);
  assert.equal(store.read()?.app?.startedAt, 5);
  assert.equal("version" in store.read()!, false);
  assert.equal(currentVersion(HISTORY_FORMAT), 1);
});

test("session-history.json from a newer build: reads refuse, events are not recorded over it, idle time is unknown", () => {
  const dir = tmp("hist2");
  const store = new FileSessionHistoryStore(dir);
  const file = join(dir, "session-history.json");
  const original = JSON.stringify({ version: 2, spans: {} });
  writeFileSync(file, original);
  assert.throws(
    () => store.read(),
    (e) => assertNewer(e, file),
  );
  const recorder = new SessionHistoryRecorder(store, () => 5);
  recorder.record({ type: "login" });
  assert.equal(recorder.idleMs("web"), null);
  assert.throws(() => recorder.read(), NewerFormatError);
  assert.equal(readFileSync(file, "utf8"), original);
  assert.equal(store.storedVersion(), 2);
  writeFileSync(file, "{broken");
  assert.equal(store.storedVersion(), null);
});

// ---------- doctor ----------

function doctorDeps(home: string) {
  return {
    getContext: () => {
      throw new Error("doctor never builds a context");
    },
    stdout: () => {},
    stderr: () => {},
    env: {},
    home,
    platform: "linux" as const,
    version: "0",
    fetchImpl: async () => ({ status: 200 }),
    browserProbes: {
      resolvePlaywright: () => {
        throw new Error("not installed");
      },
      chromiumPath: async () => "/nowhere/chromium",
    },
  };
}

test("doctor reports the version of config.json, session.enc and session-history.json", async () => {
  const dir = tmp("doctor");
  const state = join(dir, "state");
  writeFileSync(join(dir, "config.json"), JSON.stringify({ school: "taby" }));
  new FileSessionStore(state).save(session);
  new SessionHistoryRecorder(new FileSessionHistoryStore(state), () => 1).record({ type: "login" });
  const byName = async (overrides: Record<string, unknown>) =>
    Object.fromEntries(
      (await runDoctor(doctorDeps(dir), overrides, false, "v22.0.0")).checks.map((c) => [
        c.name,
        c,
      ]),
    );
  const checks = await byName({ configDir: dir });
  assert.match(checks.config.detail, /config\.json format v0, upgraded to v1 on the next write$/);
  assert.match(checks.session.detail, /; format v1$/);
  assert.match(checks["session-history"].detail, /^keepalive=off; format v1; /);
  const envOnly = await byName({ school: "taby", configDir: tmp("doctor-empty") });
  assert.match(envOnly.config.detail, /config\.json absent$/);
});

test("doctor fails the check of each file from a newer build with the update message", async () => {
  const dir = tmp("doctor-newer");
  const state = join(dir, "state");
  mkdirSync(state, { recursive: true });
  writeFileSync(join(dir, "config.json"), JSON.stringify({ version: 5, school: "taby" }));
  const config = (
    await runDoctor(doctorDeps(dir), { configDir: dir }, false, "v22.0.0")
  ).checks.find((c) => c.name === "config")!;
  assert.equal(config.ok, false);
  assert.match(config.detail, /written by a newer version of schoolsoft-agent/);
  writeFileSync(join(dir, "config.json"), "{oops");
  const corrupt = (await runDoctor(doctorDeps(dir), { configDir: dir }, false, "v22.0.0"))
    .checks[1];
  assert.deepEqual([corrupt.name, corrupt.ok], ["config", false]);
  assert.match(corrupt.detail, /^Error: Could not parse/);

  writeFileSync(join(dir, "config.json"), JSON.stringify({ school: "taby" }));
  new FileSessionStore(state).save(session);
  sealLocal(state, { ...session, version: 5 });
  writeFileSync(join(state, "session-history.json"), JSON.stringify({ version: 5 }));
  const result = await runDoctor(doctorDeps(dir), { configDir: dir }, false, "v22.0.0");
  const byName = Object.fromEntries(result.checks.map((c) => [c.name, c]));
  assert.equal(result.ok, false);
  assert.equal(byName.session.ok, false);
  assert.match(byName.session.detail, /session\.enc was written by a newer version/);
  assert.equal(byName["session-history"].ok, false);
  assert.match(
    byName["session-history"].detail,
    /session-history\.json was written by a newer version/,
  );
});
