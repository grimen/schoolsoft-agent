/**
 * The connector's encrypted repositories are versioned inside the payload
 * (docs/planning/specs/2026-09-26-versioned-state.md): v0 payloads load and
 * are rewritten with a version, a newer payload is refused and left as it
 * was, a malformed version fails closed, and a newer file stops startup.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AgentError,
  HISTORY_FORMAT,
  SESSION_FORMAT,
  emptyHistory,
  type PersistedSession,
  type VersionedFormat,
} from "../../src/core/index.js";
import { EncryptedRepository } from "../../src/http/storage.js";
import { OAUTH_STATE_FORMAT } from "../../src/http/oauth.js";
import { IDENTITY_FORMAT, composeConnector } from "../../src/http/start.js";
import { connectorConfig } from "../../src/http/config.js";
import { assertNewer } from "../helpers/versioned.js";

const tmp = (prefix: string) => mkdtempSync(join(tmpdir(), `ss-versioned-${prefix}-`));

const session: PersistedSession = {
  provider: "schoolsoft",
  school: "testskola",
  data: { accessToken: "a", refreshToken: "r" },
  savedAt: 1,
  authMethod: "bankid-browser",
};

const KEY = Buffer.alloc(32, 7);

function sealRepo(dir: string, name: string, doc: unknown): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  cipher.setAAD(Buffer.from(name + ".enc"));
  const body = Buffer.concat([cipher.update(JSON.stringify(doc)), cipher.final()]);
  const blob = Buffer.concat([iv, cipher.getAuthTag(), body]);
  writeFileSync(join(dir, name + ".enc"), blob);
  return blob;
}

function openRepo(dir: string, name: string): unknown {
  const data = readFileSync(join(dir, name + ".enc"));
  const d = createDecipheriv("aes-256-gcm", KEY, data.subarray(0, 12));
  d.setAAD(Buffer.from(name + ".enc"));
  d.setAuthTag(data.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(data.subarray(28)), d.final()]).toString());
}

const oauthState = { clients: {}, pending: {}, codes: {}, grants: {}, tokens: {}, refresh: {} };
const connectorCases: {
  name: string;
  format: VersionedFormat;
  v0: unknown;
  value: object;
}[] = [
  { name: "session", format: SESSION_FORMAT, v0: session, value: session },
  // The connector history was always written with `version: 1`, like the local file.
  { name: "history", format: HISTORY_FORMAT, v0: emptyHistory(), value: emptyHistory() },
  { name: "oauth", format: OAUTH_STATE_FORMAT, v0: oauthState, value: oauthState },
  {
    name: "identity",
    format: IDENTITY_FORMAT,
    v0: "schoolsoft:taby:1",
    value: { identity: "schoolsoft:taby:1" },
  },
];

for (const c of connectorCases) {
  test(`connector ${c.name}.enc: v0 loads and is rewritten with version 1; v1 loads; newer refuses untouched; malformed fails closed`, () => {
    const dir = tmp(`repo-${c.name}`);
    try {
      const repo = new EncryptedRepository<object>(dir, c.name, KEY, c.format);
      sealRepo(dir, c.name, c.v0);
      assert.deepEqual(repo.read(), c.value);
      repo.write(repo.read()!);
      assert.deepEqual(openRepo(dir, c.name), { version: 1, ...c.value });
      assert.deepEqual(repo.read(), c.value);

      const file = join(dir, c.name + ".enc");
      const blob = sealRepo(dir, c.name, { version: 2, ...c.value });
      assert.throws(
        () => repo.read(),
        (e) => assertNewer(e, file),
      );
      assert.deepEqual(readFileSync(file), blob);

      sealRepo(dir, c.name, { version: 1.5 });
      assert.throws(
        () => repo.read(),
        (e) => e instanceof AgentError && e.kind === "input" && /cannot be read/.test(e.message),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("connector: a newer file in its state directory stops composition and is left alone", () => {
  const dir = tmp("connector");
  try {
    const config = connectorConfig({
      SCHOOLSOFT_PUBLIC_URL: "https://connector.example",
      SCHOOLSOFT_ADMIN_PASSWORD: "synthetic-admin-password-0123456789",
      SCHOOLSOFT_STORAGE_KEY: KEY.toString("hex"),
      SCHOOLSOFT_SCHOOL: "synthetic",
      SCHOOLSOFT_STATE_DIR: dir,
    });
    const blob = sealRepo(dir, "oauth", { version: 9, ...oauthState });
    assert.throws(
      () => composeConnector(config),
      (e) => assertNewer(e, join(dir, "oauth.enc")),
    );
    assert.deepEqual(readFileSync(join(dir, "oauth.enc")), blob);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
