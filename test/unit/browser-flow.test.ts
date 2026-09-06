/**
 * Tests the BankID browser-flow callback server against real localhost
 * HTTP — success, state mismatch, provider error, and port conflicts.
 * The browser opener is injected so no real browser is involved; the
 * "user completing BankID" is simulated by fetching the callback URL.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { runBrowserLogin } from "../../src/providers/schoolsoft/auth/browser-flow.js";

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
      void fetch(`http://127.0.0.1:${port}/callback?code=EVIL&state=wrong-state`);
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
      void fetch(`http://127.0.0.1:${port}/callback?state=${encodeURIComponent(state)}`);
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
      void fetch(`http://127.0.0.1:${port}/callback?code=X&state=${encodeURIComponent(state)}`);
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
      void fetch(`http://127.0.0.1:${port}/callback?code=X&state=${encodeURIComponent(state)}`);
    },
  });
  const { authUrl } = await login;
  assert.match(authUrl, /\/react\/#\/login\/student\?/);
});

test("timeout rejects and closes the server; a non-callback path gets 404", async () => {
  const port = usePort();
  await assert.rejects(
    runBrowserLogin({ school: "testskola", port, timeoutMs: 30, openBrowser: () => {} }),
    /timed out/,
  );
  const port2 = usePort();
  const login = runBrowserLogin({
    school: "testskola",
    port: port2,
    openBrowser: async (authUrl) => {
      const other = await fetch(`http://127.0.0.1:${port2}/other`);
      assert.equal(other.status, 404);
      const state = stateFrom(authUrl);
      void fetch(`http://127.0.0.1:${port2}/callback?code=C&state=${encodeURIComponent(state)}`);
    },
  });
  assert.equal((await login).result.code, "C");
});

test("default port and default opener are used when not given", async () => {
  const { DEFAULT_CALLBACK_PORT } = await import("../../src/core/auth/callback-server.js");
  const login = runBrowserLogin({
    school: "testskola",
    openBrowser: (authUrl) => {
      const state = stateFrom(authUrl);
      void fetch(
        `http://127.0.0.1:${DEFAULT_CALLBACK_PORT}/callback?code=D&state=${encodeURIComponent(state)}`,
      );
    },
  });
  assert.equal((await login).result.code, "D");
});

test("defaultOpenInBrowser spawns the platform opener detached and survives a missing binary", async () => {
  const { EventEmitter } = await import("node:events");
  const { defaultOpenInBrowser, openerCommand } =
    await import("../../src/core/auth/open-browser.js");
  assert.deepEqual(openerCommand("http://x?a=1&b=2", "darwin"), ["open", "http://x?a=1&b=2"]);
  assert.deepEqual(openerCommand("http://x?a=1&b=2", "win32"), [
    "cmd",
    "/c",
    "start",
    "",
    "http://x?a=1^&b=2",
  ]);
  assert.deepEqual(openerCommand("http://x", "linux"), ["xdg-open", "http://x"]);
  const spawned: { cmd: string; args: string[]; opts: unknown }[] = [];
  const child = Object.assign(new EventEmitter(), {
    unref: () => spawned.push({ cmd: "unref", args: [], opts: null }),
  });
  const spawnImpl = ((cmd: string, args: string[], opts: unknown) => {
    spawned.push({ cmd, args, opts });
    return child;
  }) as never;
  const errors: string[] = [];
  const orig = console.error;
  console.error = (m: string) => errors.push(m);
  try {
    defaultOpenInBrowser("http://x", spawnImpl, "linux");
    child.emit("error", new Error("ENOENT xdg-open"));
    defaultOpenInBrowser("http://y", spawnImpl);
  } finally {
    console.error = orig;
  }
  assert.equal(spawned[0].cmd, "xdg-open");
  assert.deepEqual(spawned[0].opts, { detached: true, stdio: "ignore" });
  assert.equal(spawned[1].cmd, "unref");
  assert.match(errors[0], /Could not open browser automatically \(ENOENT xdg-open\)/);
  assert.equal(spawned.length, 4, "second call used the real platform's opener");
});

test("the error page escapes whatever the identity provider put in the query string", async () => {
  const port = usePort();
  let resolveBody!: (b: string) => void;
  const bodyPromise = new Promise<string>((r) => (resolveBody = r));
  const login = runBrowserLogin({
    school: "testskola",
    port,
    openBrowser: () => {
      void fetch(
        `http://127.0.0.1:${port}/callback?error=${encodeURIComponent('<script>alert("x")</script>&"')}`,
      )
        .then((res) => res.text())
        .then(resolveBody);
    },
  });
  await assert.rejects(login, /alert/);
  const body = await bodyPromise;
  assert.ok(body.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&quot;"), body);
  assert.ok(!body.includes("<script>alert"), "raw script tag must not appear");
});
