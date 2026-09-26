/**
 * The request budget: one limiter in front of every request a process sends
 * to the school portal. `RequestBudget` is the port a provider's transport
 * and the browser session call; `PortalBudget` is the production
 * implementation, a token bucket with a concurrency cap (limiter.ts) behind a
 * circuit breaker with backoff (breaker.ts). Nothing is ever retried here:
 * a request is sent once or not at all, so writes stay at-most-once.
 * Vendor-neutral: the caller says how to read the status and Retry-After of
 * its own answer shape. Clock, timer and "is this background work?" are
 * injected (wiring.ts).
 */
import { PortalPushbackError, RequestCancelledError } from "../errors/index.js";
import { Breaker, type BreakerState } from "./breaker.js";
import { Limiter, type BudgetTimer } from "./limiter.js";
import { DEFAULT_BREAKER_POLICY, type BreakerPolicy, type BudgetLimits } from "./policy.js";
import { parseRetryAfter } from "./retry-after.js";

export type { BudgetTimer } from "./limiter.js";
export type { BreakerState } from "./breaker.js";

export interface OutboundCall {
  /** Changes data at the portal: never the probe, never sent while the breaker is not closed. */
  write?: boolean;
  /** The caller's cancellation; a request cancelled while queued is never sent. */
  signal?: AbortSignal;
}

/** What the budget needs to know about an answer. */
export interface OutboundAnswer {
  status: number;
  /** The raw Retry-After header, when the answer carried one. */
  retryAfter?: string | null;
}

export interface BudgetSnapshot {
  breaker: BreakerState;
  /** When requests may flow again (epoch ms); null when they flow now. */
  retryAt: number | null;
  inFlight: number;
  queued: number;
  limits: BudgetLimits;
}

export interface RequestBudget {
  /**
   * Send one request under the budget: wait for a token and a slot, refuse
   * at once when the portal is pushing back, and learn from the answer
   * (`read`). A 429 answer rejects with PortalPushbackError; a 5xx answer is
   * returned for the caller to report, and counts as push-back.
   */
  run<T>(
    call: OutboundCall,
    send: () => Promise<T>,
    read: (answer: T) => OutboundAnswer,
  ): Promise<T>;
  snapshot(): BudgetSnapshot;
}

export interface PortalBudgetOptions {
  limits: BudgetLimits;
  now: () => number;
  timer: BudgetTimer;
  policy?: BreakerPolicy;
  /** True while background work (keepalive) is running; it waits for nothing and never probes. */
  isBackground?: () => boolean;
}

export class PortalBudget implements RequestBudget {
  private readonly breaker: Breaker;
  private readonly limiter: Limiter;

  constructor(private readonly o: PortalBudgetOptions) {
    this.breaker = new Breaker(o.policy ?? DEFAULT_BREAKER_POLICY);
    this.limiter = new Limiter({
      limits: o.limits,
      now: o.now,
      timer: o.timer,
      cancelled: () => new RequestCancelledError(),
    });
  }

  snapshot(): BudgetSnapshot {
    const now = this.o.now();
    return {
      breaker: this.breaker.state(now),
      retryAt: this.breaker.retryAt(now),
      inFlight: this.limiter.active,
      queued: this.limiter.waiting,
      limits: { ...this.o.limits },
    };
  }

  async run<T>(
    call: OutboundCall,
    send: () => Promise<T>,
    read: (answer: T) => OutboundAnswer,
  ): Promise<T> {
    const probe = await this.admit(call);
    try {
      await this.limiter.acquire(call.signal);
    } catch (e) {
      this.breaker.abandon(probe);
      throw e;
    }
    let answer: T;
    try {
      answer = await send();
    } catch (e) {
      this.settle(() => this.breaker.pushback(this.o.now(), probe, null));
      throw e;
    }
    const { status, retryAfter } = read(answer);
    if (status === 429 || status >= 500) {
      const now = this.o.now();
      this.settle(() => this.breaker.pushback(now, probe, parseRetryAfter(retryAfter, now)));
      if (status === 429)
        throw new PortalPushbackError({
          reason: "slow_down",
          retryAt: this.breaker.retryAt(now) ?? now,
          now,
          sent: true,
        });
      return answer;
    }
    this.settle(() => this.breaker.success(probe));
    return answer;
  }

  /** Pass the breaker, waiting out a short pause; resolves with whether this request is the probe. */
  private async admit(call: OutboundCall): Promise<boolean> {
    const background = this.o.isBackground?.() ?? false;
    for (;;) {
      if (call.signal?.aborted) throw new RequestCancelledError();
      const now = this.o.now();
      const admission = this.breaker.admit(now, { write: call.write === true, background });
      if (admission.kind === "go") return admission.probe;
      if (admission.kind === "refuse")
        throw new PortalPushbackError({ ...admission, now, sent: false });
      await this.sleep(admission.until - now, call.signal);
    }
  }

  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        this.o.timer.clear(handle);
        reject(new RequestCancelledError());
      };
      const handle = this.o.timer.set(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  /** Release the slot, apply what the answer taught the breaker, and tell the queue. */
  private settle(learn: () => void): void {
    learn();
    const now = this.o.now();
    const state = this.breaker.state(now);
    if (state === "open") {
      const retryAt = this.breaker.retryAt(now)!;
      this.limiter.flush(
        () => new PortalPushbackError({ reason: "paused", retryAt, now, sent: false }),
      );
    } else {
      this.limiter.hold(this.breaker.retryAt(now) ?? now);
    }
    this.limiter.release();
  }
}

/** What a UI or a status report says about the portal: requests flow, pause, are paused, or one is testing. */
export interface PortalHealth {
  state: "ok" | "backing_off" | "paused" | "probing";
  /** ISO-8601, when requests may flow again; null when they flow now or a probe decides. */
  retryAt: string | null;
}

export function portalHealth(snapshot: BudgetSnapshot): PortalHealth {
  const retryAt = snapshot.retryAt === null ? null : new Date(snapshot.retryAt).toISOString();
  if (snapshot.breaker === "open") return { state: "paused", retryAt };
  if (snapshot.breaker === "half_open") return { state: "probing", retryAt: null };
  return { state: retryAt === null ? "ok" : "backing_off", retryAt };
}
