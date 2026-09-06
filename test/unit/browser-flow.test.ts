/**
 * Tests the BankID browser-flow callback server against real localhost
 * HTTP — success, state mismatch, provider error, and port conflicts.
 * The browser opener is injected so no real browser is involved; the
 * "user completing BankID" is simulated by fetching the callback URL.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { runBrowserLogin } from "../../src/core/auth/browser-flow.js";

let nextPort = 43200;
function usePort(): number {
  return nextPort++;
}

/** Extract the state param that runBrowserLogin embedded in the auth URL. */
function stateFrom(authUrl: string): string {
  const m = authUrl.match(/[?&]state=([^&]+)/);
  assert.ok(m, `no state in authUrl: ${authUrl}`);
  return decodeURIComponent(m![1]);
}

test("happy path: callback with correct state resolves with the code", async () => {
  const port = usePort();
  const login = runBrowserLogin({
    school: "testskola",
    port,
    openBrowser: (authUrl) => {
      // Simulate the user completing BankID → SchoolSoft redirects back.
      const state = stateFrom(authUrl);
      void fetch(
        `http://127.0.0.1:${port}/callback?code=THE_CODE&state=${encodeURIComponent(state)}`,
      );
    },
  });
  const { result, authUrl } = await login;
  assert.equal(result.code, "THE_CODE");
  assert.ok(result.verifier.length > 20, "PKCE verifier present");
  assert.match(authUrl, /redirect_uri=http%3A%2F%2F127\.0\.0\.1/);
});

test("state mismatch is rejected (CSRF protection)", async () => {
  const port = usePort();
  const login = runBrowserLogin({
    school: "testskola",
    port,
    openBrowser: () => {
      void fetch(
        `http://127.0.0.1:${port}/callback?code=EVIL&state=wrong-state`,
      );
    },
  });
  await assert.rejects(login, /state mismatch/i);
});

test("provider error param is surfaced", async () => {
  const port = usePort();
  const login = runBrowserLogin({
    school: "testskola",
    port,
    openBrowser: () => {
      void fetch(`http://127.0.0.1:${port}/callback?error=access_denied`);
    },
  });
  await assert.rejects(login, /access_denied/);
});

test("missing code is rejected", async () => {
  const port = usePort();
  const login = runBrowserLogin({
    school: "testskola",
    port,
    openBrowser: (authUrl) => {
      const state = stateFrom(authUrl);
      void fetch(
        `http://127.0.0.1:${port}/callback?state=${encodeURIComponent(state)}`,
      );
    },
  });
  await assert.rejects(login, /missing code/i);
});

test("occupied port produces an actionable error", async () => {
  const port = usePort();
  const blocker = createServer(() => {});
  await new Promise<void>((res) => blocker.listen(port, "127.0.0.1", res));
  try {
    await assert.rejects(
      runBrowserLogin({ school: "testskola", port, openBrowser: () => {} }),
      /Could not start callback server/,
    );
  } finally {
    blocker.close();
  }
});

test("auth URL targets the parent login route by default (guardians, not students)", async () => {
  const port = usePort();
  const login = runBrowserLogin({
    school: "testskola",
    port,
    openBrowser: (authUrl) => {
      const state = stateFrom(authUrl);
      void fetch(
        `http://127.0.0.1:${port}/callback?code=X&state=${encodeURIComponent(state)}`,
      );
    },
  });
  const { authUrl } = await login;
  assert.match(authUrl, /\/testskola\/react\/#\/login\/parent\?/);
  assert.doesNotMatch(authUrl, /login\/student/);
});

test("auth URL honours an explicit userType", async () => {
  const port = usePort();
  const login = runBrowserLogin({
    school: "testskola",
    port,
    userType: "student",
    openBrowser: (authUrl) => {
      const state = stateFrom(authUrl);
      void fetch(
        `http://127.0.0.1:${port}/callback?code=X&state=${encodeURIComponent(state)}`,
      );
    },
  });
  const { authUrl } = await login;
  assert.match(authUrl, /\/react\/#\/login\/student\?/);
});
