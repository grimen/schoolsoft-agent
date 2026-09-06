/**
 * Mid-session recovery: a rejected session triggers one silent
 * re-establishment and a retry; a second rejection names login; web-session
 * losses and unrelated errors are not retried.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { withSessionRecovery, isRecoverable } from "../../src/core/portal/recovering.js";
import { UpstreamError, NetworkError } from "../../src/core/errors/index.js";
import { SessionLostError, type Portal } from "../../src/core/portal/types.js";

function portalThat(sequence: (() => Promise<unknown>)[]) {
  let i = 0;
  const calls: number[] = [];
  const portal = {
    getScheduleWeek: async (week: number) => {
      calls.push(week);
      const step = sequence[Math.min(i++, sequence.length - 1)];
      return step();
    },
  } as unknown as Portal;
  return { portal, calls };
}

test("isRecoverable: app-session rejections yes, web-session loss and other errors no", () => {
  assert.equal(isRecoverable(new UpstreamError(401, "/x")), true);
  assert.equal(isRecoverable(new UpstreamError(403, "/x")), true);
  assert.equal(isRecoverable(new UpstreamError(500, "/x")), false);
  assert.equal(isRecoverable(new SessionLostError("/p")), true);
  assert.equal(isRecoverable(new SessionLostError("/p", true)), false);
  assert.equal(isRecoverable(new NetworkError("x")), false);
  assert.equal(isRecoverable(new Error("x")), false);
});

test("a 401 is recovered once and the call repeated with the same arguments", async () => {
  const { portal, calls } = portalThat([
    async () => {
      throw new UpstreamError(401, "/lessons");
    },
    async () => ["lesson"],
  ]);
  let recovered = 0;
  const wrapped = withSessionRecovery(portal, {
    recover: async () => {
      recovered++;
    },
  });
  assert.deepEqual(await wrapped.getScheduleWeek(37), ["lesson"]);
  assert.equal(recovered, 1);
  assert.deepEqual(calls, [37, 37]);
});

test("a second rejection becomes 'rejected twice' (login hint) or the caller's own error", async () => {
  const twice = () =>
    portalThat([
      async () => {
        throw new SessionLostError("/p");
      },
    ]);
  const a = withSessionRecovery(twice().portal, { recover: async () => {} });
  await assert.rejects(a.getScheduleWeek(1), (e: Error & { key?: string; hint?: string }) => {
    assert.equal(e.key, "session_rejected_twice");
    assert.equal(e.hint, "login");
    return true;
  });
  const b = withSessionRecovery(twice().portal, {
    recover: async () => {},
    onSecondFailure: () => new Error("custom"),
  });
  await assert.rejects(b.getScheduleWeek(1), /custom/);
});

test("non-recoverable errors pass through untouched, before and after recovery; recovery failures propagate", async () => {
  const web = withSessionRecovery(
    portalThat([
      async () => {
        throw new SessionLostError("/p", true);
      },
    ]).portal,
    { recover: async () => assert.fail("must not recover a web-session loss") },
  );
  await assert.rejects(web.getScheduleWeek(1), SessionLostError);
  const other = withSessionRecovery(
    portalThat([
      async () => {
        throw new UpstreamError(401, "/x");
      },
      async () => {
        throw new NetworkError("ENOTFOUND");
      },
    ]).portal,
    { recover: async () => {} },
  );
  await assert.rejects(other.getScheduleWeek(1), NetworkError);
  const failing = withSessionRecovery(
    portalThat([
      async () => {
        throw new UpstreamError(401, "/x");
      },
    ]).portal,
    {
      recover: async () => {
        throw new Error("no saved session");
      },
    },
  );
  await assert.rejects(failing.getScheduleWeek(1), /no saved session/);
});
