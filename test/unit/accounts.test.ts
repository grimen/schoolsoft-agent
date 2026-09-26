/**
 * Accounts keyed by school (docs/planning/specs/2026-09-26-accounts-by-school.md):
 * two accounts are stored side by side without touching each other, every
 * single-account file of the old shapes (fixtures in test/fixtures/state)
 * migrates to the account it belongs to, a file from a newer build is still
 * refused and left alone, and a user of one school sees what they saw before.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONFIG_FORMAT,
  FileSessionHistoryStore,
  FileSessionStore,
  HISTORY_FORMAT,
  SESSION_FORMAT,
  SessionHistoryRecorder,
  SessionManager,
  accountKey,
  accountKeyOf,
  accountSource,
  createSessionManager,
  currentVersion,
  emptyHistory,
  foldAccountSettings,
  type PersistedSession,
  type SessionHistory,
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
import { EncryptedRepository } from "../../src/http/storage.js";
import { connectorAccountState } from "../../src/http/start.js";
import { connectorConfig } from "../../src/http/config.js";
import { FakeAuth, fakeSession, serializeFake, testConfig } from "../helpers/fakes.js";
import { assertNewer } from "../helpers/versioned.js";

const tmp = (prefix: string) => mkdtempSync(join(tmpdir(), `ss-accounts-${prefix}-`));
const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/state/${name}`, import.meta.url), "utf8");
const fixtureJson = (name: string) => JSON.parse(fixture(name)) as Record<string, unknown>;

const TABY = "schoolsoft:taby";
const VALLENTUNA = "schoolsoft:vallentuna";

const saved = (school: string, token: string): PersistedSession => ({
  provider: "schoolsoft",
  school,
  data: { accessToken: token, refreshToken: `${token}-refresh` },
  savedAt: 1,
  authMethod: "fake",
});

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

/** A state dir whose key exists, so a fixture can be sealed into session.enc. */
function stateWithKey(prefix: string): string {
  const dir = tmp(prefix);
  const store = new FileSessionStore(dir, TABY);
  store.save(saved("taby", "seed"));
  store.clear();
  return dir;
}

// ---------- the key ----------

test("the account key is provider and school; a missing provider is SchoolSoft", () => {
  assert.equal(accountKey("schoolsoft", "taby"), TABY);
  assert.equal(accountKey(undefined, "taby"), TABY);
  assert.equal(accountKey("other", "Taby"), "other:Taby");
  assert.equal(accountKeyOf({ ...testConfig, school: "vallentuna" }), VALLENTUNA);
  assert.equal(currentVersion(CONFIG_FORMAT), 2);
  assert.equal(currentVersion(SESSION_FORMAT), 2);
  assert.equal(currentVersion(HISTORY_FORMAT), 2);
});

// ---------- session.enc ----------

test("session.enc: two accounts side by side; saving, clearing one leaves the other; the last clear removes the file", () => {
  const dir = tmp("sess-two");
  const taby = new FileSessionStore(dir, TABY);
  const vallentuna = new FileSessionStore(dir, VALLENTUNA);
  taby.save(saved("taby", "t1"));
  vallentuna.save(saved("vallentuna", "v1"));
  assert.deepEqual(taby.load(), saved("taby", "t1"));
  assert.deepEqual(vallentuna.load(), saved("vallentuna", "v1"));
  assert.deepEqual(taby.accounts(), [TABY, VALLENTUNA]);

  // A refresh of one account rewrites only its entry.
  taby.save(saved("taby", "t2"));
  assert.deepEqual(vallentuna.load(), saved("vallentuna", "v1"));
  const doc = openLocal(dir);
  assert.equal(doc.version, 2);
  assert.deepEqual(Object.keys(doc.accounts as object), [TABY, VALLENTUNA]);

  taby.clear();
  assert.equal(taby.load(), null);
  assert.deepEqual(vallentuna.load(), saved("vallentuna", "v1"));
  taby.clear(); // nothing stored for it: nothing changes
  assert.deepEqual(vallentuna.accounts(), [VALLENTUNA]);
  vallentuna.clear();
  assert.equal(existsSync(join(dir, "session.enc")), false);
  assert.deepEqual(vallentuna.accounts(), []);
  assert.ok(existsSync(join(dir, "key.bin")));
});

test("session.enc v1 fixture: loads as the account it was saved for, other accounts see nothing, the next save writes v2", () => {
  const dir = stateWithKey("sess-v1");
  const v1 = fixtureJson("session-v1.json");
  sealLocal(dir, v1);
  const taby = new FileSessionStore(dir, TABY);
  const other = new FileSessionStore(dir, VALLENTUNA);
  assert.equal(taby.storedVersion(), 1);
  const { version: _v, ...expected } = v1;
  assert.deepEqual(taby.load(), expected);
  assert.equal(other.load(), null);
  other.save(saved("vallentuna", "v1"));
  const doc = openLocal(dir) as { version: number; accounts: Record<string, unknown> };
  assert.equal(doc.version, 2);
  assert.deepEqual(
    doc.accounts[TABY],
    expected,
    "the migrated entry carries no version of its own",
  );
  assert.equal(taby.storedVersion(), 2);
  assert.deepEqual(taby.load(), expected);
});

test("session.enc v0 fixture (pre-provider shape): folds its tokens and lands under schoolsoft:<school>", () => {
  const dir = stateWithKey("sess-v0");
  sealLocal(dir, fixtureJson("session-v0-pre-provider.json"));
  const taby = new FileSessionStore(dir, TABY);
  assert.equal(taby.storedVersion(), 0);
  assert.deepEqual(taby.load(), {
    school: "taby",
    data: { accessToken: "synthetic-access", refreshToken: "synthetic-refresh" },
    savedAt: 1767225600000,
    authMethod: "bankid-browser",
  });
  assert.equal(new FileSessionStore(dir, VALLENTUNA).load(), null);
});

test("session.enc v1 without a school cannot be keyed: logged out, like a corrupt file, and replaced by the next login", () => {
  const dir = stateWithKey("sess-noschool");
  sealLocal(dir, { version: 1, data: { accessToken: "x" }, savedAt: 1, authMethod: "fake" });
  const taby = new FileSessionStore(dir, TABY);
  assert.equal(taby.load(), null);
  assert.deepEqual(taby.accounts(), []);
  taby.save(saved("taby", "t1"));
  assert.deepEqual(taby.load(), saved("taby", "t1"));
});

test("session.enc v2 with a malformed accounts field holds no accounts", () => {
  const dir = stateWithKey("sess-badaccounts");
  sealLocal(dir, { version: 2, accounts: ["not", "a", "map"] });
  assert.equal(new FileSessionStore(dir, TABY).load(), null);
  sealLocal(dir, { version: 2, accounts: { [TABY]: saved("taby", "t") } });
  assert.equal(new FileSessionStore(dir, "schoolsoft:constructor").load(), null);
});

test("session.enc from a newer build (v3): load, save and clear of any account refuse; the blob is untouched", () => {
  const dir = stateWithKey("sess-v3");
  const blob = sealLocal(dir, { version: 3, accounts: {} });
  const file = join(dir, "session.enc");
  for (const store of [new FileSessionStore(dir, TABY), new FileSessionStore(dir, VALLENTUNA)]) {
    assert.throws(
      () => store.load(),
      (e) => assertNewer(e, file),
    );
    assert.throws(
      () => store.save(saved("taby", "t")),
      (e) => assertNewer(e, file),
    );
    assert.throws(
      () => store.clear(),
      (e) => assertNewer(e, file),
    );
    assert.throws(
      () => store.accounts(),
      (e) => assertNewer(e, file),
    );
  }
  assert.deepEqual(readFileSync(file), blob);
});

// ---------- session-history.json ----------

function recorder(dir: string, account: string, at: () => number) {
  return new SessionHistoryRecorder(new FileSessionHistoryStore(dir, account), at);
}

test("session-history.json: two accounts side by side; a login, loss or logout of one leaves the other's spans", () => {
  const dir = tmp("hist-two");
  let now = 1000;
  const taby = recorder(dir, TABY, () => now);
  const vallentuna = recorder(dir, VALLENTUNA, () => now);
  taby.record({ type: "login" });
  now = 2000;
  vallentuna.record({ type: "login" });
  now = 3000;
  vallentuna.record({ type: "session_lost", session: "app" });
  vallentuna.record({ type: "logout" });
  const t = taby.read();
  assert.deepEqual(t.app, {
    startedAt: 1000,
    lastActivityAt: 1000,
    activityCount: 0,
    longestGapMs: 0,
  });
  assert.deepEqual(t.losses, []);
  assert.deepEqual(
    t.events.map((e) => e.type),
    ["login"],
  );
  const v = vallentuna.read();
  assert.equal(v.app, null);
  assert.deepEqual(
    v.losses.map((l) => [l.session, l.ageMs]),
    [["app", 1000]],
  );
  assert.equal(taby.idleMs("app"), 2000);
  assert.equal(vallentuna.idleMs("app"), null);
  const file = JSON.parse(readFileSync(join(dir, "session-history.json"), "utf8"));
  assert.equal(file.version, 2);
  assert.deepEqual(Object.keys(file.accounts), [TABY, VALLENTUNA]);
  assert.deepEqual(new FileSessionHistoryStore(dir, TABY).accounts(), [TABY, VALLENTUNA]);
});

for (const [name, version] of [
  ["session-history-v1.json", 1],
  ["session-history-v0.json", 0],
] as const) {
  test(`${name}: kept as the record of the first account that writes, then that account's alone`, () => {
    const dir = tmp(`hist-v${version}`);
    const file = join(dir, "session-history.json");
    writeFileSync(file, fixture(name));
    const old = fixtureJson(name) as unknown as SessionHistory & { version?: number };
    const { version: _v, ...legacy } = old;
    const tabyStore = new FileSessionHistoryStore(dir, TABY);
    assert.equal(tabyStore.storedVersion(), version);
    // Until an account writes, every account without an entry sees the old record.
    assert.deepEqual(tabyStore.read(), legacy);
    assert.deepEqual(new FileSessionHistoryStore(dir, VALLENTUNA).read(), legacy);
    assert.deepEqual(tabyStore.accounts(), []);

    recorder(dir, TABY, () => 1767229500000).record({ type: "refresh" });
    const written = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(written.version, 2);
    assert.equal("legacy" in written, false);
    assert.deepEqual(Object.keys(written.accounts), [TABY]);
    const taby = tabyStore.read()!;
    assert.deepEqual(taby.losses, legacy.losses, "the old losses stay with the account");
    assert.equal(taby.events.length, legacy.events.length + 1);
    assert.equal(taby.app!.startedAt, legacy.app!.startedAt);
    assert.equal(new FileSessionHistoryStore(dir, VALLENTUNA).read(), null);
  });
}

test("session-history.json: an account that already has an entry does not claim the old record", () => {
  const dir = tmp("hist-legacy-kept");
  const file = join(dir, "session-history.json");
  writeFileSync(
    file,
    JSON.stringify({ version: 2, accounts: { [TABY]: emptyHistory() }, legacy: emptyHistory() }),
  );
  recorder(dir, TABY, () => 5).record({ type: "login" });
  assert.ok("legacy" in JSON.parse(readFileSync(file, "utf8")));
  recorder(dir, VALLENTUNA, () => 6).record({ type: "login" });
  assert.equal("legacy" in JSON.parse(readFileSync(file, "utf8")), false);
});

test("session-history.json from a newer build (v3): reads refuse, nothing is recorded over it", () => {
  const dir = tmp("hist-v3");
  const file = join(dir, "session-history.json");
  const original = JSON.stringify({ version: 3, accounts: {} });
  writeFileSync(file, original);
  const store = new FileSessionHistoryStore(dir, TABY);
  assert.throws(
    () => store.read(),
    (e) => assertNewer(e, file),
  );
  recorder(dir, TABY, () => 5).record({ type: "login" });
  assert.equal(readFileSync(file, "utf8"), original);
});

// ---------- the session manager over keyed stores ----------

function manager(dir: string, school: string) {
  const strategy = new FakeAuth();
  const key = accountKey("schoolsoft", school);
  return new SessionManager({
    school,
    provider: "schoolsoft",
    store: new FileSessionStore(dir, key),
    history: new SessionHistoryRecorder(new FileSessionHistoryStore(dir, key), () => 1),
    strategies: [strategy],
    createSession: (s) => fakeSession({ school: s }),
    serialize: serializeFake,
  });
}

test("two schools' logins live side by side: a logout of one leaves the other restorable", async () => {
  const dir = tmp("managers");
  const taby = manager(dir, "taby");
  const vallentuna = manager(dir, "vallentuna");
  await taby.login();
  await vallentuna.login();
  assert.equal(taby.status().saved?.school, "taby");
  assert.equal(vallentuna.status().saved?.school, "vallentuna");
  vallentuna.logout();
  assert.equal(vallentuna.status().saved, null);
  const fresh = manager(dir, "taby");
  await fresh.ensureSession();
  assert.equal(fresh.status().saved?.school, "taby");
  assert.ok(fresh.sessionHistory()!.app, "taby's history survived vallentuna's logout");
});

test("wiring opens the configured school's slot: another school neither sees nor deletes it", async () => {
  const dir = tmp("wiring");
  new FileSessionStore(dir, TABY).save(saved("taby", "t1"));
  const config = { ...testConfig, stateDir: dir, school: "taby" };
  assert.equal(createSessionManager(config).status().saved?.school, "taby");
  const other = createSessionManager({ ...config, school: "vallentuna" });
  assert.equal(other.status().saved, null);
  await assert.rejects(other.ensureSession(), /no saved session/);
  other.logout();
  assert.deepEqual(new FileSessionStore(dir, TABY).load(), saved("taby", "t1"));
});

// ---------- config.json ----------

test("config.json v1 fixture: migrates into the school's account; the resolved settings are as before", () => {
  const dir = tmp("cfg-v1");
  writeFileSync(join(dir, "config.json"), fixture("config-v1.json"));
  assert.equal(configFileVersion(dir), 1);
  assert.deepEqual(readConfigFile(dir), {
    account: TABY,
    accounts: { [TABY]: { school: "taby", orgId: "20", userType: "parent" } },
    keepalive: "app",
  });
  assert.deepEqual(fileSource(dir), {
    keepalive: "app",
    school: "taby",
    orgId: "20",
    userType: "parent",
    configDir: dir,
  });
  const config = loadConfig({
    env: {},
    home: dir,
    platform: "linux",
    overrides: { configDir: dir },
  });
  assert.deepEqual(
    [config.school, config.orgId, config.userType, config.keepalive.mode],
    ["taby", "20", "parent", "app"],
  );
});

test("config.json v0 fixture: the same migration", () => {
  const dir = tmp("cfg-v0");
  writeFileSync(join(dir, "config.json"), fixture("config-v0.json"));
  assert.equal(configFileVersion(dir), 0);
  assert.deepEqual(fileSource(dir), {
    keepalive: "app",
    school: "taby",
    orgId: "20",
    configDir: dir,
  });
});

test("config.json: account settings without a school stay at the top level and apply to any account", () => {
  const doc = foldAccountSettings({ orgId: "20", userType: "parent", cache: "off" });
  assert.deepEqual(doc, { orgId: "20", userType: "parent", cache: "off" });
  assert.deepEqual(accountSource(doc, { school: "taby" }), {
    orgId: "20",
    userType: "parent",
    cache: "off",
  });
});

test("config.json v2: a hand-written top-level school is folded in and becomes the current account", () => {
  const folded = foldAccountSettings({
    account: TABY,
    accounts: { [TABY]: { school: "taby", orgId: "20" }, [VALLENTUNA]: { school: "vallentuna" } },
    school: "vallentuna",
    orgId: "30",
  });
  assert.deepEqual(folded, {
    account: VALLENTUNA,
    accounts: {
      [TABY]: { school: "taby", orgId: "20" },
      [VALLENTUNA]: { school: "vallentuna", orgId: "30" },
    },
  });
  // A non-object entry or accounts field is ignored rather than spread.
  assert.deepEqual(
    accountSource({ account: TABY, accounts: { [TABY]: "taby" as never } as never }),
    {},
  );
  assert.deepEqual(accountSource({ account: TABY, accounts: ["x"] as never }), {});
});

test("config.json: the selected school's own settings, never another school's", () => {
  const doc = {
    account: TABY,
    accounts: {
      [TABY]: { school: "taby", orgId: "20" },
      [VALLENTUNA]: { school: "vallentuna", orgId: "30", userType: "student" },
    },
    keepalive: "app",
  };
  assert.deepEqual(accountSource(doc), { keepalive: "app", school: "taby", orgId: "20" });
  assert.deepEqual(accountSource(doc, { school: "vallentuna" }), {
    keepalive: "app",
    school: "vallentuna",
    orgId: "30",
    userType: "student",
  });
  assert.deepEqual(accountSource(doc, { school: "rosjo" }), { keepalive: "app" });
  assert.deepEqual(accountSource(doc, { provider: "schoolsoft" }), accountSource(doc));

  const dir = tmp("cfg-select");
  writeConfigFile(dir, doc);
  const load = (env: Record<string, string>, overrides = {}) =>
    loadConfig({ env, home: dir, platform: "linux", overrides: { configDir: dir, ...overrides } });
  assert.equal(load({}).orgId, "20");
  assert.equal(load({ SCHOOLSOFT_SCHOOL: "vallentuna" }).orgId, "30");
  assert.equal(load({ SCHOOLSOFT_SCHOOL: "vallentuna" }).userType, "student");
  assert.equal(load({}, { school: "rosjo" }).orgId, undefined, "no orgId borrowed from taby");
  assert.equal(load({ SCHOOLSOFT_SCHOOL: "rosjo" }, { school: "taby" }).orgId, "20");
});

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
  };
  return async (...argv: string[]) => {
    out.length = 0;
    err.length = 0;
    const code = await runCli(argv, deps);
    return { code, err: err.join("\n"), json: () => JSON.parse(out.join("\n")) };
  };
}

test("configure: a second school is stored next to the first and becomes current; going back keeps its orgId", async () => {
  const dir = tmp("cfg-configure");
  writeFileSync(join(dir, "config.json"), fixture("config-v1.json"));
  const run = cli();
  const r = await run("--config-dir", dir, "--school", "vallentuna", "configure");
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json().config, { keepalive: "app", school: "vallentuna" });
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "config.json"), "utf8")), {
    version: 2,
    account: VALLENTUNA,
    accounts: {
      [TABY]: { school: "taby", orgId: "20", userType: "parent" },
      [VALLENTUNA]: { school: "vallentuna" },
    },
    keepalive: "app",
  });
  assert.equal(fileSource(dir).orgId, undefined, "vallentuna does not borrow taby's orgId");
  const back = await run("--config-dir", dir, "--school", "taby", "configure");
  assert.equal(back.code, 0, back.err);
  assert.deepEqual(fileSource(dir), {
    keepalive: "app",
    school: "taby",
    orgId: "20",
    userType: "parent",
    configDir: dir,
  });
});

test("configure: the provider from the environment is stored with the account", async () => {
  const dir = tmp("cfg-provider");
  const r = await cli({ SCHOOLSOFT_PROVIDER: "schoolsoft" })(
    "--config-dir",
    dir,
    "--school",
    "taby",
    "configure",
  );
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(readConfigFile(dir), {
    account: TABY,
    accounts: { [TABY]: { provider: "schoolsoft", school: "taby" } },
  });
});

test("config.json from a newer build (v3): readers and configure refuse, the file is untouched", async () => {
  const dir = tmp("cfg-v3");
  const file = join(dir, "config.json");
  const original = JSON.stringify({ version: 3, account: TABY, accounts: {} });
  writeFileSync(file, original);
  assert.throws(
    () => fileSource(dir),
    (e) => assertNewer(e, file),
  );
  const r = await cli()("--config-dir", dir, "--school", "taby", "configure");
  assert.equal(r.code, 5);
  assert.match(r.err, /written by a newer version of schoolsoft-agent/);
  assert.equal(readFileSync(file, "utf8"), original);
});

// ---------- doctor ----------

test("doctor names the current account and counts the stored ones", async () => {
  const dir = tmp("doctor");
  const state = join(dir, "state");
  writeFileSync(join(dir, "config.json"), fixture("config-v1.json"));
  new FileSessionStore(state, TABY).save(saved("taby", "t1"));
  const deps = {
    getContext: () => {
      throw new Error("doctor never builds a context");
    },
    stdout: () => {},
    stderr: () => {},
    env: {},
    home: dir,
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
  const session = async (overrides: Record<string, unknown> = {}) =>
    (await runDoctor(deps, { configDir: dir, ...overrides }, false, "v22.0.0")).checks.find(
      (c) => c.name === "session",
    )!;
  const one = await session();
  assert.equal(one.ok, true);
  assert.match(one.detail, /account=schoolsoft:taby; format v2$/);
  new FileSessionStore(state, VALLENTUNA).save(saved("vallentuna", "v1"));
  assert.match((await session()).detail, /account=schoolsoft:taby, 2 accounts stored; format v2$/);
  const missing = await session({ school: "rosjo" });
  assert.equal(missing.ok, false);
  assert.match(
    missing.detail,
    /^no session for schoolsoft:rosjo in .*state — run: schoolsoft-agent login$/,
  );
});

// ---------- the connector ----------

const KEY = Buffer.alloc(32, 7);

function sealRepo(dir: string, name: string, doc: unknown): void {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  cipher.setAAD(Buffer.from(name + ".enc"));
  const body = Buffer.concat([cipher.update(JSON.stringify(doc)), cipher.final()]);
  writeFileSync(join(dir, name + ".enc"), Buffer.concat([iv, cipher.getAuthTag(), body]));
}

function connector(dir: string, school = "taby") {
  return connectorConfig({
    SCHOOLSOFT_PUBLIC_URL: "https://connector.example",
    SCHOOLSOFT_ADMIN_PASSWORD: "synthetic-admin-password-0123456789",
    SCHOOLSOFT_STORAGE_KEY: KEY.toString("hex"),
    SCHOOLSOFT_SCHOOL: school,
    SCHOOLSOFT_STATE_DIR: dir,
  });
}

test("connector: session and history are kept per account; the last clear removes session.enc", () => {
  const dir = tmp("connector-two");
  const taby = connectorAccountState(connector(dir), TABY);
  const vallentuna = connectorAccountState(connector(dir, "vallentuna"), VALLENTUNA);
  taby.store.save(saved("taby", "t1"));
  vallentuna.store.save(saved("vallentuna", "v1"));
  taby.history.write({ ...emptyHistory(), events: [{ type: "login", at: 1 }] });
  vallentuna.history.write(emptyHistory());
  assert.deepEqual(taby.store.load(), saved("taby", "t1"));
  assert.deepEqual(vallentuna.store.load(), saved("vallentuna", "v1"));
  assert.equal(taby.history.read()!.events.length, 1);
  assert.equal(vallentuna.history.read()!.events.length, 0);
  const repo = new EncryptedRepository<object>(dir, "session", KEY, SESSION_FORMAT);
  assert.deepEqual(Object.keys((repo.read() as { accounts: object }).accounts), [TABY, VALLENTUNA]);
  taby.store.clear();
  assert.equal(taby.store.load(), null);
  assert.deepEqual(vallentuna.store.load(), saved("vallentuna", "v1"));
  taby.store.clear();
  vallentuna.store.clear();
  assert.equal(existsSync(join(dir, "session.enc")), false);
  assert.equal(taby.store.load(), null);
});

test("connector: v1 session.enc and history.enc fixtures migrate to the connector's account", () => {
  const dir = tmp("connector-v1");
  const session = fixtureJson("session-v1.json");
  const history = fixtureJson("session-history-v1.json");
  sealRepo(dir, "session", session);
  sealRepo(dir, "history", history);
  const { store, history: histories } = connectorAccountState(connector(dir), TABY);
  const { version: _s, ...expectedSession } = session;
  const { version: _h, ...expectedHistory } = history;
  assert.deepEqual(store.load(), expectedSession);
  assert.deepEqual(histories.read(), expectedHistory);
  store.save(store.load()!);
  histories.write(histories.read()!);
  const sessions = new EncryptedRepository<object>(dir, "session", KEY, SESSION_FORMAT).read();
  assert.deepEqual(sessions, { accounts: { [TABY]: expectedSession } });
  const histories2 = new EncryptedRepository<object>(dir, "history", KEY, HISTORY_FORMAT).read();
  assert.deepEqual(histories2, { accounts: { [TABY]: expectedHistory } });
});
