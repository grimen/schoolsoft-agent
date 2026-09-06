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
import { sessionManager } from "../../src/services/wiring.js";
import { NotAuthenticatedError } from "../../src/services/session-manager.js";
import {
  skip,
  initReport,
  record,
  loadPersisted,
  forceExpireAccessToken,
  e2eStore,
} from "./helpers.js";

initReport();

test("A1: bootstrap — silent restore, else interactive BankID login", { skip }, async () => {
  const manager = sessionManager();
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
  const { SessionManager } = await import("../../src/services/session-manager.js");
  const { BankIdBrowserStrategy } = await import("../../src/auth/bankid-browser.js");
  const cold = new SessionManager({
    school: process.env.SCHOOLSOFT_SCHOOL!,
    store: e2eStore(),
    strategies: [new BankIdBrowserStrategy()],
  });
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
    const { SessionManager } = await import("../../src/services/session-manager.js");
    const { BankIdBrowserStrategy } = await import("../../src/auth/bankid-browser.js");
    const cold = new SessionManager({
      school: process.env.SCHOOLSOFT_SCHOOL!,
      store,
      strategies: [new BankIdBrowserStrategy()],
    });
    await assert.rejects(() => cold.ensureSession(), NotAuthenticatedError);
    assert.equal(store.load(), null, "bad session must be cleared");
  } finally {
    store.save(backup!); // restore the good session for later suites
  }
});
