/** The whole parent journey over real HTTP: production composition (encrypted disk
 * state, real OAuth provider, real runtime and provider) with only the portal's HTTP
 * replaced at the injected fetch seam. The scenario itself lives in
 * test/packaging/connector-smoke/flow.mjs so `make connector-smoke` can replay it
 * against the Docker image. The sibling http-*.test.ts files cover each module's edge
 * cases with a stubbed runtime; this one proves the pieces agree with each other.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectorConfig } from "../../src/http/config.js";
import { composeConnector } from "../../src/http/start.js";
import { runConnectorFlow } from "../packaging/connector-smoke/flow.mjs";
import {
  fakeUpstream,
  FAKE_GUARDIAN,
  FAKE_UPSTREAM_SECRETS,
} from "../packaging/connector-smoke/fake-upstream.mjs";

test("owner sign-in, OAuth consent, scoped MCP reads, rotation, revocation and throttling agree end to end", async (t) => {
  const stateDir = mkdtempSync(join(tmpdir(), "connector-flow-"));
  const config = connectorConfig({
    SCHOOLSOFT_PUBLIC_URL: "https://connector.example",
    SCHOOLSOFT_ADMIN_PASSWORD: "synthetic-admin-password-for-the-flow-test",
    SCHOOLSOFT_STORAGE_KEY: "cd".repeat(32),
    SCHOOLSOFT_SCHOOL: "synthetic-fixture",
    SCHOOLSOFT_STATE_DIR: stateDir,
    // The flow plays one reverse proxy so it can act as several callers.
    SCHOOLSOFT_PROXY_HOPS: "1",
  });
  const upstream = fakeUpstream();
  // Anything that bypassed the injected seam would surface here instead of on the network.
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("The connector flow test must not use the network");
  });
  const { app, runtime } = composeConnector(config, { fetchImpl: upstream.fetchImpl });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const { steps } = await runConnectorFlow({
      base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      origin: config.publicUrl,
      adminPassword: config.adminPassword,
    });
    assert.equal(steps.length, 11);
    // The limited grant never reached the calendar endpoints; only the full grant did, once.
    const agenda = upstream.calls.filter((call) => call.includes("/agenda"));
    assert.deepEqual(agenda, [
      "GET /rest-api/parent/calendar/lessons/agenda",
      "GET /rest-api/parent/calendar/event/agenda",
    ]);
    // The refused child never became the session's child in focus under the limited grant:
    // every weekly-schedule read was for the approved child (asserted in the flow by its echo).
    assert.equal(upstream.calls.filter((call) => call.includes("/lessons/week/")).length, 1);
    const files = readdirSync(stateDir);
    assert.deepEqual(files.sort(), ["history.enc", "identity.enc", "oauth.enc", "session.enc"]);
    for (const file of files) {
      const bytes = readFileSync(join(stateDir, file)).toString("latin1");
      for (const secret of [
        ...FAKE_UPSTREAM_SECRETS,
        ...FAKE_GUARDIAN.children.map((child) => child.firstName),
        "Smoke full app",
        config.adminPassword,
      ])
        assert.ok(!bytes.includes(secret), `${file} must not contain ${secret} in plaintext`);
    }
  } finally {
    await runtime.close();
    server.close();
    server.closeAllConnections();
    await once(server, "close");
    rmSync(stateDir, { recursive: true, force: true });
  }
});
