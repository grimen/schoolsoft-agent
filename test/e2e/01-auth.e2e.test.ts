/**
 * 01 — Auth paths against real SchoolSoft.
 *
 * Run order matters (node:test runs sequentially within a file):
 * bootstrap first, then the paths that depend on a live session.
 *
 * First ever run: your browser opens — complete BankID within 5 min.
 * Every later run must pass with zero interaction; if a BankID prompt
 * appears on a rerun, silent restore is broken and that IS the bug.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { NotAuthenticatedError } from "../../src/core/index.js";
import {
  skip,
  initReport,
  record,
  loadPersisted,
  forceExpireAccessToken,
  e2eStore,
  e2eContext,
} from "./helpers.js";

initReport();

test("A1: bootstrap — silent restore, else interactive BankID login", { skip }, async () => {
  const manager = e2eContext().manager;
  let path = "silent-restore";
  try {
    await manager.ensureSession();
  } catch (e) {
    if (!(e instanceof NotAuthenticatedError)) throw e;
    path = "interactive-login";
    console.log("→ Browser opening — complete BankID there (5 min timeout)…");
    const info = await manager.login();
    console.log("✓ logged in as:", info);
    record(
      "Q1",
      "Does SchoolSoft's OAuth accept a localhost redirect_uri?",
      "YES — interactive login completed via 127.0.0.1 callback",
    );
    record(
      "Q2",
      "Does the guardian/BankID route work for this school slug?",
      `YES — userType=${info.userType}, school=${info.schoolName}`,
    );
  }
  const client = await manager.ensureSession();
  assert.ok(await client.verifySession(), "session must verify after bootstrap");
  record("A1", "Auth bootstrap path taken", path);
});

test("A2: persisted session exists with expected shape", { skip }, async () => {
  const saved = loadPersisted();
  assert.ok(saved, "session must be persisted after bootstrap");
  assert.ok(saved!.accessToken, "access token persisted");
  record(
    "Q4a",
    "Refresh token persisted?",
    saved!.refreshToken ? "YES" : "NO — sessions will die with access token",
  );
  record(
    "Q4b",
    "Access token expiry",
    saved!.accessTokenExpiresAt
      ? new Date(saved!.accessTokenExpiresAt * 1000).toISOString()
      : "not reported by API",
  );
});

test("A3: forced access-token expiry triggers silent refresh", { skip }, async (t) => {
  if (!forceExpireAccessToken()) {
    record("Q4c", "Silent refresh works?", "UNTESTABLE — no refresh token saved");
    t.skip("no refresh token persisted; cannot exercise refresh path");
    return;
  }
  // New manager instance = cold start, must go through restore+refresh.
  const { createSessionManager } = await import("../../src/core/index.js");
  const { loadConfig } = await import("../../src/shared/bootstrap.js");
  const { homedir } = await import("node:os");
  const cold = createSessionManager(
    loadConfig({ env: process.env, home: homedir(), platform: process.platform }),
    { store: e2eStore() },
  );
  const client = await cold.ensureSession(); // must NOT prompt for BankID
  assert.ok(await client.verifySession());
  const refreshed = loadPersisted();
  assert.ok(
    (refreshed?.accessTokenExpiresAt ?? 0) > Math.floor(Date.now() / 1000),
    "expiry must have been pushed forward by refresh",
  );
  record("Q4c", "Silent refresh works?", "YES — expired token refreshed without user");
});

test("A4: garbage session fails closed with actionable error", { skip }, async () => {
  const store = e2eStore();
  const backup = store.load();
  assert.ok(backup);
  try {
    store.save({ ...backup!, accessToken: "corrupt", refreshToken: "corrupt" });
    const { createSessionManager } = await import("../../src/core/index.js");
    const { loadConfig } = await import("../../src/shared/bootstrap.js");
    const { homedir } = await import("node:os");
    const cold = createSessionManager(
      loadConfig({ env: process.env, home: homedir(), platform: process.platform }),
      { store },
    );
    await assert.rejects(() => cold.ensureSession(), NotAuthenticatedError);
    assert.equal(store.load(), null, "bad session must be cleared");
  } finally {
    store.save(backup!); // restore the good session for later suites
  }
});
