/**
 * The reference page in REAL Chromium against the connector (production composition,
 * fake portal at the fetch seam): the parent's whole path through the page, the owner
 * sign-in and the consent page, as a browser really sends it. It checks what the
 * offline suite cannot: that the hash-scoped policy lets the inline script and styles
 * run and blocks nothing the page needs, and that the browser's own Origin and
 * Referer rules let the owner's form posts through. Hermetic: no SchoolSoft.
 * Skips with a reason when playwright/Chromium is not installed (CI installs it).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browserStatus } from "../../src/core/browser/install.js";
import { composeConnector } from "../../src/http/start.js";
import type { ConnectorConfig } from "../../src/http/config.js";
import {
  FAKE_GUARDIAN,
  FAKE_UPSTREAM_CODE,
  fakeUpstream,
} from "../packaging/connector-smoke/fake-upstream.mjs";

const status = await browserStatus({ kind: "chromium" });
const skip = status.ready ? false : `headless browser not installed (${status.hint})`;
const [ALVA, BO] = FAKE_GUARDIAN.children;

test(
  "a parent connects the reference page in a real browser and reads one child's week",
  { skip, timeout: 60_000 },
  async () => {
    const { chromium } = await import("playwright");
    const stateDir = mkdtempSync(join(tmpdir(), "reference-page-e2e-"));
    // Browsers treat http://localhost as a secure context (Secure cookies, crypto.subtle),
    // so the connector can run without TLS here; the configured origin must match exactly.
    const probe = (await import("node:net")).createServer().listen(0, "127.0.0.1");
    await once(probe, "listening");
    const port = (probe.address() as AddressInfo).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    const config: ConnectorConfig = {
      publicUrl: `http://localhost:${port}`,
      proxyHops: 0,
      adminPassword: "synthetic-admin-password-for-the-browser-e2e-0123456789",
      storageKey: Buffer.alloc(32, 7),
      stateDir,
      port,
      school: "synthetic-fixture",
    };
    // The request budget's ceilings, so the fake portal is not paced like the real one.
    const { app, runtime } = composeConnector(
      config,
      { fetchImpl: fakeUpstream().fetchImpl },
      {
        SCHOOLSOFT_REQUESTS_PER_MINUTE: "60",
        SCHOOLSOFT_REQUEST_BURST: "20",
        SCHOOLSOFT_MAX_CONCURRENT_REQUESTS: "4",
      },
    );
    const server = app.listen(port, "127.0.0.1");
    await once(server, "listening");
    const browser = await chromium.launch();
    try {
      const { url } = await runtime.beginLogin();
      assert.ok(
        runtime.callback(
          decodeURIComponent(/[?&#]state=([^&#]+)/.exec(url)![1]),
          FAKE_UPSTREAM_CODE,
        ),
      );
      for (let attempt = 0; !(await runtime.status()).authenticated; attempt++) {
        assert.ok(attempt < 50, "the fake sign-in did not complete");
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const page = await browser.newPage();
      // Week 37 of 2026 holds the fake portal's lessons.
      await page.clock.setFixedTime(new Date("2026-09-09T10:00:00Z"));
      const violations: string[] = [];
      page.on("console", (message) => {
        if (/Content.Security.Policy|Refused to/i.test(message.text()))
          violations.push(message.text());
      });
      page.on("pageerror", (error) => violations.push(error.message));

      await page.goto(config.publicUrl + "/reference/");
      await page.click('[data-action="connect"]');
      await page.fill('input[name="password"]', config.adminPassword);
      await page.click('button[type="submit"]');
      // The owner's own form post got through: the consent page, for this page's callback.
      await page.waitForSelector('input[name="children"]');
      assert.match(
        await page.content(),
        /shown in this browser on your connector's reference page/,
      );
      await page.check(`input[name="children"][value="${ALVA.studentId}"]`);
      await page.check(`input[name="children"][value="${BO.studentId}"]`);
      await page.click("text=Allow selected access");

      await page.waitForSelector("text=Week 37: Synthetic Alva");
      assert.equal(new URL(page.url()).search, "", "the code left the address bar");
      assert.match(await page.locator("main").innerText(), /08:00–09:00 Synthetic lesson/);
      assert.match(await page.locator("main").innerText(), /All day Synthetic school event/);
      // The styles applied: the days are laid out as a grid.
      assert.equal(
        await page.locator(".days").evaluate((el) => getComputedStyle(el).display),
        "grid",
      );

      await page.selectOption('select[data-action="child"]', String(BO.studentId));
      await page.waitForSelector("text=Week 37: Synthetic Bo");
      assert.equal(await page.locator("h1").innerText(), "Week 37: Synthetic Bo");

      // A reload keeps the connection (refresh token in this tab) without new consent.
      await page.reload();
      await page.waitForSelector("text=Week 37: Synthetic Alva");
      await page.click('[data-action="disconnect"]');
      await page.waitForSelector("text=Disconnected");
      assert.deepEqual(violations, []);
    } finally {
      await browser.close();
      server.close();
      server.closeAllConnections();
      await runtime.close();
      rmSync(stateDir, { recursive: true, force: true });
    }
  },
);
