/**
 * The owner dashboard's form posts in REAL Chromium against the connector (production
 * composition, fake portal at the fetch seam). The offline suite sets `Origin` itself;
 * only a browser shows what it really sends. Under `Referrer-Policy: no-referrer` a
 * browser sends `Origin: null` on a same-origin form post and the owner routes refuse
 * it, so this test guards the connector's `same-origin` policy. Hermetic: no SchoolSoft.
 * Skips with a reason when playwright/Chromium is not installed (CI installs it).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browserStatus } from "../../src/core/browser/install.js";
import { composeConnector } from "../../src/http/start.js";
import type { ConnectorConfig } from "../../src/http/config.js";
import { fakeUpstream } from "../packaging/connector-smoke/fake-upstream.mjs";

const status = await browserStatus({ kind: "chromium" });
const skip = status.ready ? false : `headless browser not installed (${status.hint})`;

test(
  "a browser's own form posts reach the owner routes: sign in, start the SchoolSoft sign-in, sign out",
  { skip, timeout: 60_000 },
  async () => {
    const { chromium } = await import("playwright");
    const probe = createServer().listen(0, "127.0.0.1");
    await once(probe, "listening");
    const port = (probe.address() as AddressInfo).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    const stateDir = mkdtempSync(join(tmpdir(), "owner-forms-e2e-"));
    // Browsers treat http://localhost as a secure context (Secure, __Host- cookies), so
    // the connector runs without TLS here; the configured origin must match exactly.
    const config: ConnectorConfig = {
      publicUrl: `http://localhost:${port}`,
      proxyHops: 0,
      adminPassword: "synthetic-admin-password-for-the-owner-e2e-0123456789",
      storageKey: Buffer.alloc(32, 9),
      stateDir,
      port,
      school: "synthetic-fixture",
    };
    const { app, runtime } = composeConnector(config, { fetchImpl: fakeUpstream().fetchImpl });
    const server = app.listen(port, "127.0.0.1");
    await once(server, "listening");
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const refused: string[] = [];
      page.on("response", (response) => {
        if (response.request().method() === "POST" && response.status() === 403)
          refused.push(new URL(response.url()).pathname);
      });

      const login = await page.goto(config.publicUrl + "/owner/login");
      await page.fill('input[name="password"]', config.adminPassword);
      const [posted] = await Promise.all([
        page.waitForResponse(
          (r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/owner/login",
        ),
        page.click('button[type="submit"]'),
      ]);
      assert.equal(posted.status(), 302, "the browser's own sign-in post was refused");
      assert.equal(login!.headers()["referrer-policy"], "same-origin");
      await page.waitForURL(/\/owner$/);
      assert.match(await page.content(), /Your SchoolSoft connector/);

      // A dashboard form: Origin and CSRF token both checked.
      await Promise.all([
        page.waitForSelector("text=Complete BankID"),
        page.click("text=Sign in with BankID"),
      ]);
      await page.goto(config.publicUrl + "/owner");
      await Promise.all([
        page.waitForURL(/\/owner\/login$/),
        page.click("text=Sign out of this dashboard"),
      ]);
      assert.deepEqual(refused, [], "no owner form post was refused");
    } finally {
      await browser.close();
      server.close();
      server.closeAllConnections();
      await runtime.close();
      rmSync(stateDir, { recursive: true, force: true });
    }
  },
);
