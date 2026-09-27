/**
 * The E11.4 done criterion in real Chromium: a grant from the reference page, pasted into
 * the app's development connect screen, lists the grant's children through the dev proxy.
 * Hermetic: the connector runs against the fake portal; no SchoolSoft.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browserStatus } from "../../../src/core/browser/install.js";
import { composeConnector } from "../../../src/http/start.js";
import type { ConnectorConfig } from "../../../src/http/config.js";
import {
  FAKE_GUARDIAN,
  FAKE_UPSTREAM_CODE,
  fakeUpstream,
} from "../../../test/packaging/connector-smoke/fake-upstream.mjs";
import { createProxy } from "../scripts/dev-proxy.mjs";

const status = await browserStatus({ kind: "chromium" });
const skip = status.ready ? false : `headless browser not installed (${status.hint})`;
const [ALVA, BO] = FAKE_GUARDIAN.children;

async function freePort(): Promise<number> {
  const probe = (await import("node:net")).createServer().listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((r) => probe.close(() => r()));
  return port;
}

test(
  "the app lists the grant's children from a running connector",
  { skip, timeout: 240_000 },
  async () => {
    const { chromium } = await import("playwright");
    const stateDir = mkdtempSync(join(tmpdir(), "app-web-e2e-"));
    const exportDir = mkdtempSync(join(tmpdir(), "app-web-export-"));
    execFileSync(
      "npx",
      ["expo", "export", "--platform", "web", "--dev", "--output-dir", exportDir],
      {
        cwd: join(import.meta.dirname, ".."),
        stdio: "inherit",
      },
    );

    const port = await freePort();
    const config: ConnectorConfig = {
      publicUrl: `http://localhost:${port}`,
      proxyHops: 0,
      adminPassword: "synthetic-admin-password-for-the-app-e2e-0123456789",
      storageKey: Buffer.alloc(32, 9),
      stateDir,
      port,
      school: "synthetic-fixture",
    };
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
    const proxyPort = await freePort();
    const proxy = createProxy({ connector: new URL(config.publicUrl), staticDir: exportDir });
    proxy.listen(proxyPort, "127.0.0.1");
    await once(proxy, "listening");
    const browser = await chromium.launch();
    try {
      const { url } = await runtime.beginLogin();
      assert.ok(
        runtime.callback(
          decodeURIComponent(/[?&#]state=([^&#]+)/.exec(url)![1]!),
          FAKE_UPSTREAM_CODE,
        ),
      );
      for (let attempt = 0; !(await runtime.status()).authenticated; attempt++) {
        assert.ok(attempt < 50, "the fake sign-in did not complete");
        await new Promise((r) => setTimeout(r, 20));
      }

      // 1. A grant through the reference page, as a developer would get one.
      const ref = await browser.newPage();
      await ref.goto(config.publicUrl + "/reference/");
      await ref.click('[data-action="connect"]');
      await ref.fill('input[name="password"]', config.adminPassword);
      await ref.click('button[type="submit"]');
      await ref.waitForSelector('input[name="children"]');
      await ref.check(`input[name="children"][value="${ALVA.studentId}"]`);
      await ref.check(`input[name="children"][value="${BO.studentId}"]`);
      await ref.click("text=Allow selected access");
      await ref.waitForSelector(`text=${ALVA.firstName}`);
      const saved = JSON.parse(
        (await ref.evaluate(() => sessionStorage.getItem("schoolsoft-reference")))!,
      ) as {
        client: { id: string };
        refresh: string;
      };
      await ref.close(); // as the connect screen tells the developer to

      // 2. The app, through the proxy's origin only. This flow's REST reads are same-origin
      // GETs, which carry no Origin header; its POST /token refresh carries one, but the token
      // endpoint doesn't check it. The rewrite itself is covered by dev-proxy.test.mjs; it
      // matters for REST calls that carry Origin (non-GET ones, e.g. a future write).
      const page = await browser.newPage();
      const origins = new Set<string>();
      page.on("request", (r) => origins.add(new URL(r.url()).origin));
      const appOrigin = `http://127.0.0.1:${proxyPort}`;
      await page.goto(appOrigin + "/");
      await page.getByLabel("Client ID").fill(saved.client.id);
      await page.getByLabel("Refresh token").fill(saved.refresh);
      await page.getByText("Connect", { exact: true }).click();
      await page.waitForSelector(`text=${ALVA.firstName}`);
      assert.ok(await page.getByText(BO.firstName).isVisible());
      assert.deepEqual([...origins], [appOrigin]);
    } finally {
      await browser.close();
      proxy.close();
      server.close();
      server.closeAllConnections();
      await runtime.close();
      rmSync(stateDir, { recursive: true, force: true });
      rmSync(exportDir, { recursive: true, force: true });
    }
  },
);
