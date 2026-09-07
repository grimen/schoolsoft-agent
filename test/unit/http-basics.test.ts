import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectorConfig } from "../../src/http/config.js";
import { EncryptedRepository } from "../../src/http/storage.js";
import { OwnerSessions } from "../../src/http/owner-session.js";
import { escapeHtml, page, form, hidden } from "../../src/http/pages.js";
const env = {
  SCHOOLSOFT_PUBLIC_URL: "https://connector.example",
  SCHOOLSOFT_ADMIN_PASSWORD: "p".repeat(32),
  SCHOOLSOFT_STORAGE_KEY: "a".repeat(64),
  SCHOOLSOFT_SCHOOL: "example",
};
test("connector settings reject unsafe/missing configuration without disclosing secrets", () => {
  const cfg = connectorConfig(env);
  assert.equal(cfg.port, 3000);
  assert.equal(cfg.stateDir, "/data");
  assert.equal(cfg.storageKey.length, 32);
  assert.equal(
    connectorConfig({
      ...env,
      SCHOOLSOFT_STORAGE_KEY: Buffer.alloc(32).toString("base64"),
      PORT: "4000",
      SCHOOLSOFT_STATE_DIR: "/private",
    }).port,
    4000,
  );
  for (const url of [
    undefined,
    "bad",
    "http://example.com",
    "https://a:b@example.com",
    "https://example.com?q=x",
    "https://example.com#x",
    "https://example.com/a",
    "https://example.com:443/?x",
  ])
    assert.throws(() => connectorConfig({ ...env, SCHOOLSOFT_PUBLIC_URL: url }));
  assert.throws(() =>
    connectorConfig({ ...env, SCHOOLSOFT_PUBLIC_URL: "https://:pw@example.com" }),
  );
  for (const password of [undefined, "short"])
    assert.throws(() => connectorConfig({ ...env, SCHOOLSOFT_ADMIN_PASSWORD: password }));
  for (const key of [
    undefined,
    "short",
    Buffer.alloc(32).toString("base64").replace(/=$/, ""),
    "A".repeat(43) + "=garbage",
  ])
    assert.throws(() => connectorConfig({ ...env, SCHOOLSOFT_STORAGE_KEY: key }));
  for (const school of [undefined, "../x"])
    assert.throws(() => connectorConfig({ ...env, SCHOOLSOFT_SCHOOL: school }));
  for (const port of ["0", "65536", "1.2", "bad"])
    assert.throws(() => connectorConfig({ ...env, PORT: port }));
});
test("encrypted repository authenticates files, writes atomically and survives restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "connector-storage-"));
  const key = Buffer.alloc(32, 3);
  try {
    const repository = new EncryptedRepository<{ secret: string }>(dir, "state", key);
    assert.equal(repository.read(), undefined);
    repository.clear();
    repository.write({ secret: "SYNTHETIC_PRIVATE_VALUE" });
    const filename = join(dir, "state.enc");
    const data = readFileSync(filename);
    assert.ok(!data.includes("SYNTHETIC_PRIVATE_VALUE"));
    assert.equal(statSync(filename).mode & 0o777, 0o600);
    assert.deepEqual(new EncryptedRepository(dir, "state", key).read(), {
      secret: "SYNTHETIC_PRIVATE_VALUE",
    });
    assert.throws(() => new EncryptedRepository(dir, "state", Buffer.alloc(32)).read());
    data[28] ^= 1;
    writeFileSync(filename, data);
    assert.throws(() => repository.read());
    writeFileSync(filename, Buffer.from("broken"));
    assert.throws(() => repository.read());
    repository.write({ secret: "replaced" });
    assert.deepEqual(repository.read(), { secret: "replaced" });
    repository.clear();
    assert.equal(repository.read(), undefined);
    mkdirSync(filename);
    assert.throws(() => repository.read());
    assert.throws(() => repository.clear());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("owner sessions bound attempts, expire, discard malformed cookies and reset", () => {
  let now = 0;
  const sessions = new OwnerSessions("correct", () => now);
  assert.equal(sessions.get(undefined), undefined);
  assert.equal(sessions.get("other=x"), undefined);
  assert.equal(sessions.get("__Host-owner=unknown"), undefined);
  assert.equal(sessions.login(12), undefined);
  assert.equal(sessions.login("wrong"), undefined);
  const result = sessions.login("correct")!;
  assert.ok(result);
  assert.equal(sessions.get("other=x; __Host-owner=" + result.token), result.session);
  assert.equal(sessions.login("wrong"), undefined);
  assert.equal(sessions.login("wrong"), undefined);
  assert.equal(sessions.login("correct"), undefined);
  now += 60_001;
  assert.ok(sessions.login("correct"));
  now += 30 * 60_000;
  assert.equal(sessions.get("__Host-owner=" + result.token), undefined);
  for (let i = 0; i < 18; i++) {
    now += 60_001;
    assert.ok(sessions.login("correct"));
  }
  const last = sessions.login("correct")!;
  sessions.clear();
  assert.equal(sessions.get("__Host-owner=" + last.token), undefined);
  assert.ok(new OwnerSessions("a").login("a"));
});
test("HTML rendering escapes every interpolated field", () => {
  assert.equal(escapeHtml("&<>\"'"), "&amp;&lt;&gt;&quot;&#39;");
  assert.match(page("<script>", "<p>trusted</p>"), /&lt;script&gt;/);
  assert.match(form('"', '"', "trusted", "<"), /&quot;/);
  assert.match(hidden("<", '"'), /&lt;/);
});

test("owner throttling separates callers and dashboard sign-out preserves other sessions", () => {
  const sessions = new OwnerSessions("correct", () => 0);
  for (let i = 0; i < 5; i++) assert.equal(sessions.login("wrong", "attacker"), undefined);
  assert.equal(sessions.login("correct", "attacker"), undefined);
  const owner = sessions.login("correct", "owner")!;
  const other = sessions.login("correct", "other")!;
  sessions.logout("__Host-owner=" + owner.token);
  assert.equal(sessions.get("__Host-owner=" + owner.token), undefined);
  assert.ok(sessions.get("__Host-owner=" + other.token));
  sessions.logout(undefined);
  for (let i = 0; i < 1025; i++) sessions.login("wrong", "client-" + i);
  assert.ok(sessions.login("correct", "new-owner"));
  for (const hops of ["bad", "-1", "3", "1.5"])
    assert.throws(() => connectorConfig({ ...env, SCHOOLSOFT_PROXY_HOPS: hops }));
  assert.equal(connectorConfig({ ...env, SCHOOLSOFT_PROXY_HOPS: "0" }).proxyHops, 0);
});
