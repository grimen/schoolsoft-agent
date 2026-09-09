import { SchoolsoftClient } from "@elias4044/ssp-node";
import { test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { ConnectorRuntime, type ConnectorRuntimeOptions } from "../../src/http/runtime.js";
import {
  MemorySessionStore,
  MemoryPendingLoginStore,
  resolveConfig,
} from "../../src/core/index.js";

function fixture(options: { timeout?: number; pinned?: string; now?: () => number } = {}) {
  const store = new MemorySessionStore();
  let identity = options.pinned;
  let userId = 21;
  let failed = false;
  let children = [100, 101];
  let rejectRead = false;
  let onRead: (() => void) | undefined;
  const events: string[] = [];
  const runtimeOptions: ConnectorRuntimeOptions = {
    config: resolveConfig([{ school: "taby" }], { home: "/unused", platform: "linux" }),
    redirectUri: "https://parent.example/school/callback",
    store,
    identityStore: {
      read: () => identity,
      write: (id) => {
        identity = id;
      },
    },
    loginTimeoutMs: options.timeout,
    now: options.now,
    deps: {
      pending: new MemoryPendingLoginStore(),
      fetchImpl: async (
        url: string,
        _school: string,
        request: { headers?: Record<string, string> },
      ) => {
        if (failed) throw new Error("upstream unavailable");
        if (url.includes("/login/token"))
          return {
            status: 200,
            data: { access_token: "token", refresh_token: "refresh", expires: 3600 },
            headers: {},
            setCookies: [],
          };
        if (url.endsWith("/eva/api/v1/parent"))
          return {
            status: 200,
            data: {
              userId,
              firstName: "Parent",
              lastName: "Test",
              children: children.map((studentId) => ({
                studentId,
                firstName: `Child ${studentId}`,
                schools: [{ orgId: 20, name: "School" }],
              })),
            },
            headers: {},
            setCookies: [],
          };
        if (url.includes("eva-apps/auth")) {
          const child = request.headers!.childInFocus;
          events.push(`focus:${child}`);
          await delay(1);
          return {
            status: 303,
            data: "",
            headers: {},
            setCookies: [`JSESSIONID=${child}; Path=/`, "hash=h; Path=/"],
          };
        }
        events.push(`read:${request.headers?.Cookie ?? "lunch"}`);
        onRead?.();
        if (rejectRead) {
          rejectRead = false;
          return { status: 401, data: null, headers: {}, setCookies: [] };
        }
        await delay(5);
        return {
          status: 200,
          data: url.includes("/agenda?")
            ? [
                {
                  eventId: 1,
                  name: "Synthetic",
                  startDate: "2026-09-07T09:00",
                  endDate: "2026-09-07T10:00",
                  allDay: false,
                  cookie: request.headers?.Cookie,
                },
              ]
            : [request.headers?.Cookie ?? "lunch"],
          headers: {},
          setCookies: [],
        };
      },
    },
  };
  const runtime = new ConnectorRuntime(runtimeOptions);
  return {
    runtime,
    runtimeOptions,
    store,
    events,
    identity: () => identity,
    rejectNextRead: (remaining = [100, 101]) => {
      children = remaining;
      rejectRead = true;
    },
    onRead: (callback: () => void) => {
      onRead = callback;
    },
    changeUser: () => {
      userId = 22;
    },
    fail: () => {
      failed = true;
    },
  };
}
async function login(runtime: ConnectorRuntime) {
  const { url } = await runtime.beginLogin();
  const state = new URLSearchParams(url.split("?")[1]).get("state")!;
  assert.equal(runtime.callback(state, "CODE"), true);
  await runtime.execute("list_children", {}, [100, 101]);
  return state;
}

test("remote login state is exact, one-use, private; metadata and reads honor child consent", async () => {
  const f = fixture();
  assert.deepEqual(await f.runtime.status(), {
    authenticated: false,
    loginInProgress: false,
    children: [],
  });
  const { url } = await f.runtime.beginLogin();
  assert.equal((await f.runtime.status()).loginInProgress, true);
  await assert.rejects(f.runtime.beginLogin(), /already in progress/);
  const state = new URLSearchParams(url.split("?")[1]).get("state")!;
  assert.equal(f.runtime.callback("wrong", "CODE"), false);
  assert.equal(f.runtime.callback("x".repeat(state.length), "CODE"), false);
  assert.equal(f.runtime.callback(state, ""), false);
  assert.equal(f.runtime.callback(state, "CODE"), true);
  assert.equal(f.runtime.callback(state, "CODE"), false);
  assert.deepEqual(await f.runtime.execute("list_children", {}, [101]), {
    children: [{ studentId: 101, firstName: "Child 101" }],
    childInFocus: null,
  });
  assert.equal(f.identity(), "schoolsoft:taby:21");
  assert.deepEqual(await f.runtime.status(), {
    authenticated: true,
    loginInProgress: false,
    children: [
      { id: 100, name: "Child 100" },
      { id: 101, name: "Child 101" },
    ],
  });
  await assert.rejects(f.runtime.execute("get_messages", {}, [100]), /not available/);
  await assert.rejects(f.runtime.execute("get_schedule", { week: 54 }, [100]), /arguments/);
  await assert.rejects(f.runtime.execute("get_schedule", { unknown: 1 }, [100]), /arguments/);
  await assert.rejects(f.runtime.execute("get_schedule", {}, []), /No permitted/);
  await assert.rejects(f.runtime.execute("get_schedule", {}, [999]), /No permitted/);
  await assert.rejects(f.runtime.execute("get_schedule", {}, [101]), /not permitted/);
  await assert.rejects(
    f.runtime.execute("get_schedule", { child_id: 101 }, [100]),
    /not permitted/,
  );
  assert.deepEqual(await f.runtime.execute("get_lunch_menu", { week: 2 }, [100]), {
    week: 2,
    child: { studentId: 100, firstName: "Child 100" },
    menu: ["lunch"],
  });
  await f.runtime.logout();
  assert.equal(f.store.load(), null);
  assert.equal(f.identity(), "schoolsoft:taby:21");
  await assert.rejects(f.runtime.execute("get_schedule", {}, [100]), /Not logged in/);
  assert.equal(f.runtime.callback(state, "CODE"), false);
  await f.runtime.close();
  await assert.rejects(f.runtime.beginLogin(), /closed/);
  await assert.rejects(f.runtime.execute("list_children", {}, [100]), /closed/);
  assert.equal((await f.runtime.status()).authenticated, false);
});

test("concurrent reads keep focus and request atomic; logout waits for an active read", async () => {
  const f = fixture();
  await login(f.runtime);
  f.events.length = 0;
  const a = f.runtime.execute("get_schedule", { child_id: 101, week: 2 }, [100, 101]);
  const b = f.runtime.execute("get_schedule", { child_id: 100, week: 3 }, [100, 101]);
  const logout = f.runtime.logout();
  const [first, second] = await Promise.all([a, b]);
  assert.deepEqual(first, {
    week: 2,
    child: { studentId: 101, firstName: "Child 101" },
    lessons: ["JSESSIONID=101; hash=h; usertype=1"],
  });
  assert.deepEqual(second, {
    week: 3,
    child: { studentId: 100, firstName: "Child 100" },
    lessons: ["JSESSIONID=100; hash=h; usertype=1"],
  });
  assert.deepEqual(f.events, [
    "focus:101",
    "read:JSESSIONID=101; hash=h; usertype=1",
    "focus:100",
    "read:JSESSIONID=100; hash=h; usertype=1",
  ]);
  await logout;
  assert.equal(f.store.load(), null);
  await f.runtime.close();
});

test("wrong guardian never becomes available and credentials are cleared", async () => {
  const f = fixture({ pinned: "schoolsoft:taby:999" });
  const { url } = await f.runtime.beginLogin();
  f.runtime.callback(new URLSearchParams(url.split("?")[1]).get("state")!, "CODE");
  await assert.rejects(f.runtime.execute("list_children", {}, [100]), /Not logged in/);
  assert.equal(f.store.load(), null);
  assert.equal((await f.runtime.status()).authenticated, false);
  assert.equal(f.identity(), "schoolsoft:taby:999");
  assert.equal((await f.runtime.status()).loginError, "different_guardian");
  await f.runtime.close();
});

test("deadline and cancellation terminate pending login and reject late callbacks", async () => {
  let now = 0;
  const f = fixture({ timeout: 20, now: () => now });
  const { url } = await f.runtime.beginLogin();
  now = 21;
  assert.equal(
    f.runtime.callback(new URLSearchParams(url.split("?")[1]).get("state")!, "CODE"),
    false,
  );
  await f.runtime.logout();
  assert.equal((await f.runtime.status()).loginError, "expired");
  const again = await f.runtime.beginLogin();
  await delay(30);
  assert.equal(
    f.runtime.callback(new URLSearchParams(again.url.split("?")[1]).get("state")!, "CODE"),
    false,
  );
  assert.equal((await f.runtime.status()).authenticated, false);
  await f.runtime.beginLogin();
  await f.runtime.close();
  assert.equal((await f.runtime.status()).loginError, "cancelled");
});

test("cancel queued login before it starts and close after callback cannot persist credentials", async () => {
  const f = fixture();
  const beginning = f.runtime.beginLogin();
  const rejection = assert.rejects(beginning, /cancelled/);
  await f.runtime.logout();
  await rejection;
  assert.equal((await f.runtime.status()).loginError, "cancelled");
  const { url } = await f.runtime.beginLogin();
  f.runtime.callback(new URLSearchParams(url.split("?")[1]).get("state")!, "CODE");
  await f.runtime.close();
  assert.equal(f.store.load(), null);
});

test("failed upstream login clears any partial tokens", async () => {
  const f = fixture();
  const { url } = await f.runtime.beginLogin();
  f.fail();
  f.runtime.callback(new URLSearchParams(url.split("?")[1]).get("state")!, "CODE");
  await assert.rejects(f.runtime.execute("list_children", {}, [100]), /Not logged in/);
  assert.equal(f.store.load(), null);
  assert.equal((await f.runtime.status()).loginError, "upstream");
  await f.runtime.close();
});

test("restart restores the encrypted-store session and enforces identity pin on restore", async (t) => {
  t.mock.method(SchoolsoftClient.prototype, "verifySession", async () => true);
  const f = fixture();
  await login(f.runtime);
  await f.runtime.close();
  const restored = new ConnectorRuntime(f.runtimeOptions);
  assert.equal((await restored.status()).authenticated, true);
  await restored.close();
  f.changeUser();
  const changed = new ConnectorRuntime(f.runtimeOptions);
  assert.equal((await changed.status()).authenticated, false);
  assert.equal(f.store.load(), null);
  await changed.close();
});

test("recovery cannot retry a read against an unapproved fallback sibling", async (t) => {
  t.mock.method(SchoolsoftClient.prototype, "verifySession", async () => true);
  const f = fixture();
  await login(f.runtime);
  f.events.length = 0;
  f.rejectNextRead([101]);
  await assert.rejects(
    f.runtime.execute("get_schedule", { week: 2 }, [100]),
    /no longer permitted/,
  );
  assert.deepEqual(f.events, ["read:JSESSIONID=100; hash=h; usertype=1", "focus:101"]);
  await f.runtime.close();
});

test("recovery revalidates the guardian and succeeds only for the original child", async (t) => {
  t.mock.method(SchoolsoftClient.prototype, "verifySession", async () => true);
  const f = fixture();
  await login(f.runtime);
  f.rejectNextRead();
  const result = await f.runtime.execute("get_schedule", { child_id: 101, week: 2 }, [101]);
  assert.deepEqual(result, {
    week: 2,
    child: { studentId: 101, firstName: "Child 101" },
    lessons: ["JSESSIONID=101; hash=h; usertype=1"],
  });
  f.changeUser();
  f.rejectNextRead();
  await assert.rejects(f.runtime.execute("get_schedule", { week: 2 }, [101]), /different guardian/);
  assert.equal(f.store.load(), null);
  await f.runtime.close();
});

test("queued revoked and aborted operations never read; interrupted results are withheld", async () => {
  const f = fixture();
  await login(f.runtime);
  f.events.length = 0;
  let active = true;
  const controller = new AbortController();
  const first = f.runtime.execute("get_schedule", {}, [100]);
  const revoked = f.runtime.execute("get_schedule", {}, [100], {
    check: () => {
      if (!active) throw new Error("revoked");
    },
  });
  const aborted = f.runtime.execute("get_schedule", {}, [100], { signal: controller.signal });
  active = false;
  controller.abort();
  await Promise.all([
    first,
    assert.rejects(revoked, /revoked/),
    assert.rejects(aborted, /cancelled/),
  ]);
  assert.equal(f.events.filter((e) => e.startsWith("read:")).length, 1);
  const late = new AbortController();
  f.onRead(() => late.abort());
  await assert.rejects(
    f.runtime.execute("get_schedule", {}, [100], { signal: late.signal }),
    /cancelled/,
  );
  await f.runtime.close();
});

test("permission guard runs after restore, during recovery and before releasing child lists", async (t) => {
  t.mock.method(SchoolsoftClient.prototype, "verifySession", async () => true);
  const f = fixture();
  await login(f.runtime);
  let checks = 0;
  await assert.rejects(
    f.runtime.execute("list_children", {}, [100], {
      check: () => {
        if (++checks === 2) throw new Error("revoked");
      },
    }),
    /revoked/,
  );
  f.rejectNextRead();
  let active = true;
  f.onRead(() => {
    active = false;
  });
  const before = f.events.filter((e) => e.startsWith("read:")).length;
  await assert.rejects(
    f.runtime.execute("get_schedule", {}, [100], {
      check: () => {
        if (!active) throw new Error("revoked");
      },
    }),
    /revoked/,
  );
  assert.equal(f.events.filter((e) => e.startsWith("read:")).length, before + 1);
  await f.runtime.close();
});

test("post-read child authorization and focus are checked before releasing results", async () => {
  const f = fixture();
  await login(f.runtime);
  const allowed = [100];
  f.onRead(() => {
    allowed.length = 0;
  });
  await assert.rejects(f.runtime.execute("get_schedule", {}, allowed), /no longer permitted/);
  // Simulate a provider changing its context during a read, despite serialization.
  f.onRead(() => {
    f.runtime["manager"].guardian().childInFocus = 101;
  });
  await assert.rejects(f.runtime.execute("get_schedule", {}, [100]), /session changed/);
  await f.runtime.close();
});

test("outstanding execute requests are bounded while owner status and cancellation remain usable", async () => {
  const f = fixture();
  await f.runtime.beginLogin();
  const queued = Array.from({ length: 16 }, () =>
    assert.rejects(f.runtime.execute("get_schedule", {}, [100]), /Not logged in/),
  );
  await assert.rejects(f.runtime.execute("get_schedule", {}, [100]), /busy/);
  assert.equal((await f.runtime.status()).loginInProgress, true);
  await f.runtime.logout();
  await Promise.all(queued);
  await assert.rejects(f.runtime.execute("get_schedule", {}, [100]), /Not logged in/);
  await f.runtime.close();
});

test("calendar reads are serialized across children and each source uses the selected child's cookies", async () => {
  const f = fixture();
  await login(f.runtime);
  f.events.length = 0;
  const results = (await Promise.all(
    [101, 100].map((child_id) =>
      f.runtime.execute(
        "get_calendar",
        { child_id, start_date: "2026-09-01", end_date: "2026-09-30" },
        [100, 101],
      ),
    ),
  )) as { child: { studentId: number }; entries: { cookie: string }[] }[];
  for (const [index, child] of [101, 100].entries()) {
    assert.equal(results[index].child.studentId, child);
    assert.equal(results[index].entries.length, 2);
    assert.ok(
      results[index].entries.every((entry) => entry.cookie.includes(`JSESSIONID=${child};`)),
    );
  }
  assert.deepEqual(f.events, [
    "focus:101",
    "read:JSESSIONID=101; hash=h; usertype=1",
    "read:JSESSIONID=101; hash=h; usertype=1",
    "focus:100",
    "read:JSESSIONID=100; hash=h; usertype=1",
    "read:JSESSIONID=100; hash=h; usertype=1",
  ]);
  await assert.rejects(
    f.runtime.execute("get_calendar", { child_id: 101 }, [100]),
    /not permitted/,
  );
  await f.runtime.close();
});

test("calendar revocation, abort and focus changes stop the second read and withhold completed results", async () => {
  for (const interruptAfter of [1, 2]) {
    for (const mode of ["revoke", "abort", "focus", "child"]) {
      const f = fixture();
      await login(f.runtime);
      f.events.length = 0;
      let active = true,
        reads = 0;
      const controller = new AbortController();
      const allowed = [100];
      f.onRead(() => {
        if (++reads !== interruptAfter) return;
        if (mode === "revoke") active = false;
        if (mode === "abort") controller.abort();
        if (mode === "focus") f.runtime["manager"].guardian().childInFocus = 101;
        if (mode === "child") allowed.length = 0;
      });
      await assert.rejects(
        f.runtime.execute("get_calendar", {}, allowed, {
          check: () => {
            if (!active) throw new Error("revoked");
          },
          signal: controller.signal,
        }),
        /revoked|cancelled|session changed|no longer permitted/,
      );
      assert.equal(f.events.filter((event) => event.startsWith("read:")).length, interruptAfter);
      await f.runtime.close();
    }
  }
});

test("calendar recovery restarts both sources for the same permitted child", async (t) => {
  t.mock.method(SchoolsoftClient.prototype, "verifySession", async () => true);
  for (const failAt of [1, 2]) {
    const f = fixture();
    await login(f.runtime);
    let reads = 0;
    f.onRead(() => {
      if (++reads === failAt) f.rejectNextRead();
    });
    const result = (await f.runtime.execute("get_calendar", { child_id: 101 }, [101])) as {
      entries: { cookie: string }[];
    };
    assert.equal(result.entries.length, 2);
    assert.ok(result.entries.every((entry) => entry.cookie.includes("JSESSIONID=101;")));
    assert.equal(reads, failAt + 2);
    await f.runtime.close();
  }
});

test("calendar recovery refuses a fallback sibling or different guardian", async (t) => {
  t.mock.method(SchoolsoftClient.prototype, "verifySession", async () => true);
  for (const mode of ["child", "guardian", "revoked"]) {
    const f = fixture();
    await login(f.runtime);
    let reads = 0,
      active = true;
    f.onRead(() => {
      if (++reads !== 2) return;
      if (mode === "guardian") f.changeUser();
      if (mode === "revoked") active = false;
      f.rejectNextRead(mode === "child" ? [101] : [100, 101]);
    });
    await assert.rejects(
      f.runtime.execute("get_calendar", {}, [100], {
        check: () => {
          if (!active) throw new Error("revoked");
        },
      }),
      /no longer permitted|different guardian|revoked/,
    );
    assert.equal(reads, 2);
    await f.runtime.close();
  }
});
