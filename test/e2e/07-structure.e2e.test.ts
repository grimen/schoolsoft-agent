/**
 * 07 — Structure canaries against real SchoolSoft: every page the browser
 * provider reads still has its anchors, and its fingerprint matches the one
 * recorded by `make fingerprints`. Anchors failing is a test failure (an
 * extractor would return nothing); fingerprint drift is recorded as a
 * finding so the fixtures and fingerprints get refreshed. Gated pages are
 * skipped without a web session. Nothing but tag/id/class skeletons is read.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  browserStatus,
  createApiPortal,
  createBrowserSession,
  verifyPages,
} from "../../src/core/index.js";
import { skip as liveSkip, record, e2eContext } from "./helpers.js";

const status = await browserStatus({ kind: "chromium" });
const skip = liveSkip || (status.ready ? false : `headless browser not installed (${status.hint})`);

test(
  "S1: anchors present on every reachable page; fingerprint drift recorded",
  { skip },
  async () => {
    const ctx = e2eContext();
    await ctx.manager.ensureSession();
    const session = createBrowserSession(ctx.manager, { engine: ctx.config.browser });
    try {
      const reports = await verifyPages(session, {
        pages: ctx.provider.pages,
        fingerprints: ctx.provider.fingerprints,
        hasWebSession: ctx.manager.getWebSession() !== null,
        syncWebChild: () => createApiPortal(ctx.manager).syncWebChild(),
      });
      const line = reports
        .map(
          (r) => `${r.page}=${r.status}${r.missing.length ? "(" + r.missing.join("|") + ")" : ""}`,
        )
        .join("; ");
      record("S1", "Page structure (anchors + fingerprints)", line);
      const broken = reports.filter((r) => r.status === "broken" || r.status === "error");
      assert.deepEqual(
        broken.map((r) => `${r.page}: ${r.missing.join(", ") || r.reason}`),
        [],
      );
      const drift = reports.filter((r) => r.status === "drift");
      if (drift.length)
        console.warn(
          `[structure drift] ${drift.map((r) => r.page).join(", ")} — run make fingerprints and refresh fixtures`,
        );
    } finally {
      await session.close();
    }
  },
);
