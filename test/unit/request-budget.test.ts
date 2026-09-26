/**
 * The request budget on a fake clock: the token bucket's ceiling, the
 * concurrency cap, cancellation, backoff on 429 and 5xx with Retry-After,
 * and the circuit breaker (open, half-open with exactly one probe, close,
 * reopen with a longer cool-down). Nothing sleeps for real.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PortalBudget,
  PortalPushbackError,
  RequestCancelledError,
  describeError,
  parseRetryAfter,
  portalHealth,
  type OutboundAnswer,
  type PortalBudgetOptions,
} from "../../src/core/index.js";
import { Breaker } from "../../src/core/budget/breaker.js";
import { Limiter } from "../../src/core/budget/limiter.js";
import { DEFAULT_BREAKER_POLICY } from "../../src/core/budget/policy.js";
import { FakeClock, fakeBudget, settle } from "../helpers/budget.js";

const SEC = 1_000;
const MIN = 60_000;

/** A controllable request: records when it was sent; resolves with the answer given (or throws). */
function upstream(clock: FakeClock) {
  const sent: number[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const send =
    (answer: OutboundAnswer | Error = { status: 200 }, hold?: Promise<void>) =>
    async (): Promise<OutboundAnswer> => {
      sent.push(clock.now());
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        if (hold) await hold;
        if (answer instanceof Error) throw answer;
        return answer;
      } finally {
        inFlight--;
      }
    };
  return {
    sent,
    get maxInFlight() {
      return maxInFlight;
    },
    send,
  };
}

const same = (a: OutboundAnswer) => a;
const pushback = (reason: "slow_down" | "paused", sent: boolean) => (e: unknown) =>
  e instanceof PortalPushbackError && e.reason === reason && e.sent === sent;

function setup(
  limits: Partial<PortalBudgetOptions["limits"]> = {},
  extra: Partial<PortalBudgetOptions> = {},
) {
  const clock = new FakeClock();
  const budget = fakeBudget(clock, limits, extra);
  const up = upstream(clock);
  const run = (
    answer?: OutboundAnswer | Error,
    o: { write?: boolean; signal?: AbortSignal; hold?: Promise<void> } = {},
  ) => budget.run({ write: o.write, signal: o.signal }, up.send(answer, o.hold), same);
  return { clock, budget, up, run };
}

/** Three push-backs in a row: the breaker opens. */
async function open(s: ReturnType<typeof setup>) {
  await s.run({ status: 503 });
  await s.clock.advance(2 * SEC);
  await s.run({ status: 502 });
  await s.clock.advance(4 * SEC);
  await s.run({ status: 500 });
  assert.equal(s.budget.snapshot().breaker, "open");
}

test("Retry-After: seconds or an HTTP date, in ms from now; absent or unreadable is null", () => {
  const now = Date.parse("2026-09-26T12:00:00Z");
  assert.equal(parseRetryAfter(undefined, now), null);
  assert.equal(parseRetryAfter(null, now), null);
  assert.equal(parseRetryAfter(" 30 ", now), 30_000);
  assert.equal(parseRetryAfter("Sat, 26 Sep 2026 12:02:00 GMT", now), 120_000);
  assert.equal(parseRetryAfter("Sat, 26 Sep 2026 11:00:00 GMT", now), 0);
  assert.equal(parseRetryAfter("soon", now), null);
});

test("ceiling: 40 callers at once never start more than burst + rate × T in any window", async () => {
  const s = setup({ perMinute: 20, burst: 10, maxInFlight: 4 });
  const all = Array.from({ length: 40 }, () => s.run());
  await s.clock.advance(0);
  assert.equal(s.up.sent.length, 10, "the burst goes at once");
  await s.clock.advance(3 * SEC);
  assert.equal(s.up.sent.length, 11, "then one every 3 s");
  await s.clock.advance(10 * MIN);
  await Promise.all(all);
  assert.equal(s.up.sent.length, 40);
  const t = s.up.sent;
  for (let i = 0; i < t.length; i++)
    for (let j = i; j < t.length; j++)
      assert.ok(
        j - i + 1 <= 10 + ((t[j] - t[i]) * 20) / MIN + 1e-9,
        `window ${i}..${j} exceeds the budget`,
      );
  assert.equal(t.at(-1)! - t[0], 30 * 3 * SEC, "40 requests: 10 at once, then 30 at 3 s each");
});

test("concurrency: never more than maxInFlight waiting for an answer; the next goes when one returns", async () => {
  const s = setup({ perMinute: 60, burst: 20, maxInFlight: 2 });
  let release!: () => void;
  const hold = new Promise<void>((r) => (release = r));
  const calls = Array.from({ length: 5 }, () => s.run({ status: 200 }, { hold }));
  await s.clock.advance(0);
  assert.equal(s.up.sent.length, 2);
  assert.deepEqual(
    { inFlight: s.budget.snapshot().inFlight, queued: s.budget.snapshot().queued },
    { inFlight: 2, queued: 3 },
  );
  release();
  await Promise.all(calls);
  assert.equal(s.up.maxInFlight, 2);
  assert.equal(s.up.sent.length, 5);
});

test("cancellation: a queued request leaves the queue without a token; one cancelled before it starts is never queued", async () => {
  const s = setup({ perMinute: 1, burst: 1, maxInFlight: 1 });
  await s.run(); // the only token
  const first = new AbortController();
  const a = s.run(undefined, { signal: first.signal });
  const b = s.run();
  await s.clock.advance(1 * SEC);
  first.abort();
  await assert.rejects(a, RequestCancelledError);
  await s.clock.advance(MIN);
  await b;
  assert.equal(s.up.sent.length, 2, "b took the token a never spent, one minute after the first");
  const gone = new AbortController();
  gone.abort();
  await assert.rejects(s.run(undefined, { signal: gone.signal }), RequestCancelledError);
  assert.equal(s.up.sent.length, 2);
  assert.equal(
    describeError(new RequestCancelledError(), "sv", "http").message,
    "Begäran avbröts innan den skickades till SchoolSoft.",
  );
});

test("429 with Retry-After: that request fails as slow_down (sent); nothing goes out until then; a short wait is waited out", async () => {
  const s = setup();
  const t0 = s.clock.now();
  await assert.rejects(s.run({ status: 429, retryAfter: "30" }), (e: unknown) => {
    assert.ok(pushback("slow_down", true)(e));
    assert.equal((e as PortalPushbackError).retryAt, t0 + 30 * SEC);
    return true;
  });
  await s.clock.advance(5 * SEC);
  await assert.rejects(s.run(), pushback("slow_down", false), "25 s away: refused, not sent");
  await s.clock.advance(20 * SEC);
  const waiting = s.run();
  await s.clock.advance(4 * SEC);
  assert.equal(s.up.sent.length, 1, "still paused");
  await s.clock.advance(1 * SEC);
  await waiting;
  assert.deepEqual(
    s.up.sent.map((at) => at - t0),
    [0, 30 * SEC],
  );
});

test("429 without Retry-After and 5xx: pause 2 s, then 4 s; a 5xx answer is returned to the caller; Retry-After on a 503 counts", async () => {
  const s = setup();
  const t0 = s.clock.now();
  await assert.rejects(s.run({ status: 429 }), pushback("slow_down", true));
  assert.equal(s.budget.snapshot().retryAt, t0 + 2 * SEC);
  const second = s.run({ status: 502 });
  await s.clock.advance(2 * SEC);
  assert.deepEqual(await second, { status: 502 }, "the transport reports the 5xx itself");
  assert.equal(s.budget.snapshot().retryAt, t0 + 6 * SEC, "second consecutive push-back: 4 s");
  await s.clock.advance(4 * SEC);
  await s.run(); // a success clears the count
  await s.run({ status: 503, retryAfter: "8" });
  assert.equal(s.budget.snapshot().retryAt, s.clock.now() + 8 * SEC);
  assert.deepEqual(portalHealth(s.budget.snapshot()), {
    state: "backing_off",
    retryAt: new Date(s.clock.now() + 8 * SEC).toISOString(),
  });
});

test("a network failure is rethrown and counts as push-back", async () => {
  const s = setup();
  const offline = Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
  await assert.rejects(s.run(offline), /ENOTFOUND/);
  assert.equal(s.budget.snapshot().retryAt, s.clock.now() + 2 * SEC);
});

test("breaker: three push-backs within two minutes open it; requests fail fast unsent; queued ones are flushed", async () => {
  const s = setup({ maxInFlight: 1 });
  await s.run({ status: 503 });
  await s.clock.advance(2 * SEC);
  await s.run({ status: 502 });
  await s.clock.advance(4 * SEC);
  let release!: () => void;
  const third = s.run({ status: 500 }, { hold: new Promise<void>((r) => (release = r)) });
  const queued = s.run();
  await s.clock.advance(0);
  assert.equal(s.budget.snapshot().queued, 1);
  release();
  await third;
  await assert.rejects(queued, pushback("paused", false), "flushed when it opened, never sent");
  const sentBefore = s.up.sent.length;
  await assert.rejects(s.run(), (e: unknown) => {
    assert.ok(pushback("paused", false)(e));
    assert.equal((e as PortalPushbackError).retryAt, s.clock.now() + 5 * MIN);
    return true;
  });
  await assert.rejects(
    s.run(undefined, { write: true }),
    pushback("paused", false),
    "a write while open is not sent",
  );
  assert.equal(s.up.sent.length, sentBefore);
  assert.deepEqual(portalHealth(s.budget.snapshot()), {
    state: "paused",
    retryAt: new Date(s.clock.now() + 5 * MIN).toISOString(),
  });
});

test("breaker: a success in between, or push-backs further apart than the window, keep it closed", async () => {
  const s = setup();
  await s.run({ status: 503 });
  await s.clock.advance(2 * SEC);
  await s.run({ status: 503 });
  await s.clock.advance(4 * SEC);
  await s.run();
  await s.run({ status: 503 });
  await s.clock.advance(2 * SEC);
  await s.run({ status: 503 });
  assert.equal(s.budget.snapshot().breaker, "closed", "the success reset the count");
  await s.clock.advance(3 * MIN);
  await s.run({ status: 503 });
  assert.equal(s.budget.snapshot().breaker, "closed", "the two before are outside the window");
});

test("half-open: exactly one user read is the probe; writes, background work and a second caller fail fast; success closes", async () => {
  let background = false;
  const s = setup({}, { isBackground: () => background });
  await open(s);
  await s.clock.advance(5 * MIN);
  assert.deepEqual(portalHealth(s.budget.snapshot()), { state: "probing", retryAt: null });
  const sent = s.up.sent.length;
  background = true;
  await assert.rejects(s.run(), pushback("paused", false), "keepalive never tests the water");
  background = false;
  await assert.rejects(
    s.run(undefined, { write: true }),
    pushback("paused", false),
    "a write is never the probe",
  );
  let release!: () => void;
  const probe = s.run({ status: 200 }, { hold: new Promise<void>((r) => (release = r)) });
  await s.clock.advance(0);
  await assert.rejects(s.run(), (e: unknown) => {
    assert.ok(pushback("paused", false)(e));
    assert.equal((e as PortalPushbackError).retryAt, s.clock.now() + 10 * SEC);
    return true;
  });
  assert.equal(s.up.sent.length, sent + 1, "only the probe went out");
  release();
  await probe;
  assert.equal(s.budget.snapshot().breaker, "closed");
  await s.run();
  await s.run(undefined, { write: true });
  assert.deepEqual(portalHealth(s.budget.snapshot()), { state: "ok", retryAt: null });
});

test("half-open: a pushed-back probe reopens with a doubled cool-down, up to an hour; closing resets it", async () => {
  const s = setup();
  await open(s);
  const coolDowns: number[] = [];
  for (let i = 0; i < 5; i++) {
    await s.clock.advance(s.budget.snapshot().retryAt! - s.clock.now());
    await assert.rejects(s.run({ status: 429 }), pushback("slow_down", true));
    coolDowns.push(s.budget.snapshot().retryAt! - s.clock.now());
  }
  assert.deepEqual(
    coolDowns,
    [10, 20, 40, 60, 60].map((m) => m * MIN),
  );
  await s.clock.advance(60 * MIN);
  await s.run(); // the probe gets an answer
  await open(s);
  assert.equal(s.budget.snapshot().retryAt! - s.clock.now(), 5 * MIN, "back to five minutes");
});

test("Retry-After longer than the cool-down keeps it open longer, clamped to an hour; a tiny one is at least a second", async () => {
  const s = setup();
  await s.run({ status: 503 });
  await s.clock.advance(2 * SEC);
  await s.run({ status: 503 });
  await s.clock.advance(4 * SEC);
  await s.run({ status: 503, retryAfter: "900" });
  assert.equal(s.budget.snapshot().retryAt! - s.clock.now(), 15 * MIN);
  const t = setup();
  await t.run({ status: 503, retryAfter: String(24 * 3600) });
  assert.equal(t.budget.snapshot().retryAt! - t.clock.now(), 60 * MIN);
  const u = setup();
  await u.run({ status: 503, retryAfter: "0" });
  assert.equal(u.budget.snapshot().retryAt! - u.clock.now(), 1 * SEC);
});

test("background work never waits out a pause; it is refused at once", async () => {
  const s = setup({}, { isBackground: () => true });
  await s.run({ status: 503 });
  await assert.rejects(s.run(), pushback("slow_down", false));
  await s.clock.advance(2 * SEC);
  await s.run();
});

test("answers to requests sent before the breaker opened: a longer Retry-After extends it, anything else changes nothing", async () => {
  const s = setup({ maxInFlight: 4, burst: 10 });
  const holds: (() => void)[] = [];
  const late = (answer: OutboundAnswer) =>
    s.run(answer, { hold: new Promise<void>((r) => holds.push(r)) });
  const a = late({ status: 503, retryAfter: "1800" });
  const b = late({ status: 503 });
  const c = late({ status: 429 });
  await s.clock.advance(0);
  await open(s);
  const until = s.budget.snapshot().retryAt!;
  holds[1]();
  await b;
  assert.equal(s.budget.snapshot().retryAt, until, "no Retry-After: unchanged");
  holds[0]();
  await a;
  assert.equal(s.budget.snapshot().retryAt, s.clock.now() + 30 * MIN, "a longer one extends it");
  await s.clock.advance(30 * MIN); // half-open now
  holds[2]();
  await assert.rejects(c, (e: unknown) => {
    assert.ok(pushback("slow_down", true)(e));
    assert.equal(
      (e as PortalPushbackError).retryAt,
      s.clock.now(),
      "no pause to report while probing",
    );
    return true;
  });
  assert.equal(s.budget.snapshot().breaker, "half_open", "an old answer is not the probe");
});

test("a probe cancelled while it waits for a token lets the next user request probe instead", async () => {
  const s = setup({ perMinute: 0.1, burst: 3, maxInFlight: 3 });
  await Promise.all([s.run({ status: 503 }), s.run({ status: 503 }), s.run({ status: 503 })]);
  assert.equal(s.budget.snapshot().breaker, "open");
  await s.clock.advance(5 * MIN); // half-open, but the bucket holds half a token
  const cancel = new AbortController();
  const probe = s.run(undefined, { signal: cancel.signal });
  await s.clock.advance(0);
  assert.equal(s.budget.snapshot().queued, 1);
  cancel.abort();
  await assert.rejects(probe, RequestCancelledError);
  const next = s.run();
  await s.clock.advance(10 * MIN);
  await next;
  assert.equal(
    s.budget.snapshot().breaker,
    "closed",
    "the second request was the probe and closed it",
  );
});

test("a pause set while requests queue for tokens holds them until it ends", async () => {
  const s = setup({ perMinute: 60, burst: 1, maxInFlight: 2 });
  const t0 = s.clock.now();
  const failing = s.run({ status: 503, retryAfter: "5" });
  const queued = s.run();
  await failing;
  await s.clock.advance(1 * SEC);
  assert.equal(s.up.sent.length, 1, "a token is back after 1 s, but the pause holds");
  await s.clock.advance(4 * SEC);
  await queued;
  assert.deepEqual(
    s.up.sent.map((at) => at - t0),
    [0, 5 * SEC],
  );
});

test("a caller cancelled while it waits out a pause is released without being sent", async () => {
  const s = setup();
  await s.run({ status: 503 });
  const cancel = new AbortController();
  const waiting = s.run(undefined, { signal: cancel.signal });
  await settle();
  cancel.abort();
  await assert.rejects(waiting, RequestCancelledError);
  assert.equal(s.up.sent.length, 1);
  assert.equal(s.clock.pending, 0, "its timer is cleared");
});

test("Breaker on its own: abandon without a probe changes nothing", () => {
  const b = new Breaker(DEFAULT_BREAKER_POLICY);
  b.abandon(false);
  assert.deepEqual(b.admit(0, { write: false, background: false }), { kind: "go", probe: false });
});

test("push-back messages: seconds under a minute, about N minutes above, in English and Swedish, for all three surfaces", () => {
  const now = 1_000_000;
  const e = (reason: "slow_down" | "paused", seconds: number) =>
    new PortalPushbackError({ reason, retryAt: now + seconds * 1000, now, sent: false });
  const en = (x: PortalPushbackError) => describeError(x, "en", "cli");
  const sv = (x: PortalPushbackError) => describeError(x, "sv", "mcp");
  assert.match(en(e("slow_down", 1)).message, /pausing requests to it for 1 second\.$/);
  assert.match(en(e("slow_down", 45)).message, /for 45 seconds\./);
  assert.match(
    en(e("paused", 60)).message,
    /sends it nothing for about 1 minute\. Nothing was sent\./,
  );
  assert.match(en(e("paused", 290)).message, /for about 5 minutes\./);
  assert.match(sv(e("slow_down", 1)).message, /pausar förfrågningar dit i 1 sekund\.$/);
  assert.match(sv(e("slow_down", 30)).message, /i 30 sekunder\./);
  assert.match(sv(e("paused", 60)).message, /på ungefär 1 minut\. Inget skickades\./);
  assert.match(sv(e("paused", 600)).message, /på ungefär 10 minuter\./);
  const d = en(e("paused", 300));
  assert.deepEqual([d.kind, d.exitCode, d.retryable], ["upstream", 7, true]);
  assert.match(d.hint!, /Wait until then and run the command again/);
  assert.match(describeError(e("paused", 300), "en", "mcp").hint!, /Do not retry on your own/);
  assert.match(describeError(e("paused", 300), "sv", "http").hint!, /Retry-After/);
  assert.equal(e("paused", 0).params.seconds, "1", "never zero");
});

test("snapshot reports the limits it was built with and the state; PortalBudget without isBackground treats nothing as background", async () => {
  const clock = new FakeClock();
  const budget = new PortalBudget({
    limits: { perMinute: 5, burst: 2, maxInFlight: 1 },
    now: clock.now,
    timer: clock,
  });
  assert.deepEqual(budget.snapshot(), {
    breaker: "closed",
    retryAt: null,
    inFlight: 0,
    queued: 0,
    limits: { perMinute: 5, burst: 2, maxInFlight: 1 },
  });
  await budget.run({}, async () => ({ status: 503 }), same);
  const waiting = budget.run({}, async () => ({ status: 200 }), same);
  await clock.advance(2 * SEC);
  await waiting;
});

test("Limiter on its own: an already-cancelled caller is refused; a flushed caller with a signal detaches it; waiters behind the same token share one timer", async () => {
  const clock = new FakeClock();
  const limiter = new Limiter({
    limits: { perMinute: 1, burst: 1, maxInFlight: 2 },
    now: clock.now,
    timer: clock,
    cancelled: () => new RequestCancelledError(),
  });
  const gone = new AbortController();
  gone.abort();
  await assert.rejects(limiter.acquire(gone.signal), RequestCancelledError);
  await limiter.acquire(); // the token
  const live = new AbortController();
  const a = limiter.acquire(live.signal);
  const b = limiter.acquire();
  assert.equal(clock.pending, 1, "both wait for the same token: one timer");
  limiter.flush(() => new Error("opened"));
  await assert.rejects(a, /opened/);
  await assert.rejects(b, /opened/);
  live.abort(); // detached: nothing left to remove
  assert.equal(limiter.waiting, 0);
  assert.equal(clock.pending, 0);
  // A hold that ends after the next token moves the one timer to the hold's end.
  const c = limiter.acquire();
  limiter.hold(clock.now() + 2 * MIN);
  assert.equal(clock.pending, 1);
  await clock.advance(MIN + SEC);
  assert.equal(limiter.waiting, 1, "the token is back but the hold is not over");
  await clock.advance(MIN);
  await c;
  // Tokens to spare but a hold: the wait is the hold alone.
  const spare = new Limiter({
    limits: { perMinute: 60, burst: 5, maxInFlight: 2 },
    now: clock.now,
    timer: clock,
    cancelled: () => new RequestCancelledError(),
  });
  spare.hold(clock.now() + 10 * SEC);
  const d = spare.acquire();
  await clock.advance(9 * SEC);
  assert.equal(spare.waiting, 1);
  await clock.advance(1 * SEC);
  await d;
});

test("a caller with a signal that waits out a pause and is then sent", async () => {
  const s = setup();
  await s.run({ status: 503 });
  const signal = new AbortController().signal;
  const waiting = s.run(undefined, { signal });
  await s.clock.advance(2 * SEC);
  assert.deepEqual(await waiting, { status: 200 });
});
