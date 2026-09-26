/**
 * The rate half of the request budget: a token bucket (a sustained rate and
 * a burst) and a cap on requests in flight, with one FIFO queue in front of
 * both. A token is taken only when a request is granted, so a request that
 * is cancelled while it waits leaves the queue without spending one. `hold`
 * delays every grant until an instant (the breaker's backoff pause); `flush`
 * fails everything waiting (the breaker opened). Clock and timer are
 * injected; nothing here sleeps on its own.
 */
import type { BudgetLimits } from "./policy.js";

export interface BudgetTimer {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

interface Waiter {
  grant: () => void;
  fail: (error: Error) => void;
}

export class Limiter {
  private tokens: number;
  private refilledAt: number;
  private inFlight = 0;
  private holdUntil = 0;
  private readonly queue: Waiter[] = [];
  private timer: { handle: unknown; at: number } | null = null;

  constructor(
    private readonly o: {
      limits: BudgetLimits;
      now: () => number;
      timer: BudgetTimer;
      /** The error a request cancelled while queued rejects with. */
      cancelled: () => Error;
    },
  ) {
    this.tokens = o.limits.burst;
    this.refilledAt = o.now();
  }

  get active(): number {
    return this.inFlight;
  }

  get waiting(): number {
    return this.queue.length;
  }

  /** Wait for a token and a free slot; call `release` once the request has its answer. */
  acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(this.o.cancelled());
    return new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        const i = this.queue.indexOf(waiter);
        this.queue.splice(i, 1);
        reject(this.o.cancelled());
        this.pump();
      };
      const waiter: Waiter = {
        grant: () => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        },
        fail: (error) => {
          signal?.removeEventListener("abort", onAbort);
          reject(error);
        },
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.queue.push(waiter);
      this.pump();
    });
  }

  release(): void {
    this.inFlight--;
    this.pump();
  }

  /** Grant nothing before `until` (epoch ms). */
  hold(until: number): void {
    this.holdUntil = Math.max(this.holdUntil, until);
    this.pump();
  }

  /** Fail every queued request with the given error; nothing of it is sent. */
  flush(error: () => Error): void {
    for (const waiter of this.queue.splice(0)) waiter.fail(error());
    this.pump();
  }

  private refill(now: number): void {
    const added = ((now - this.refilledAt) * this.o.limits.perMinute) / 60_000;
    this.tokens = Math.min(this.o.limits.burst, this.tokens + added);
    this.refilledAt = now;
  }

  private pump(): void {
    const now = this.o.now();
    this.refill(now);
    while (
      this.queue.length > 0 &&
      this.inFlight < this.o.limits.maxInFlight &&
      now >= this.holdUntil &&
      this.tokens >= 1
    ) {
      this.tokens -= 1;
      this.inFlight++;
      this.queue.shift()!.grant();
    }
    // Only time can unblock a full bucket or a hold; a free slot arrives with release().
    const blockedByTime = this.queue.length > 0 && this.inFlight < this.o.limits.maxInFlight;
    if (!blockedByTime) return this.disarm();
    const tokenAt = now + Math.ceil(((1 - this.tokens) * 60_000) / this.o.limits.perMinute);
    this.arm(Math.max(this.holdUntil, this.tokens >= 1 ? now : tokenAt));
  }

  private arm(at: number): void {
    if (this.timer?.at === at) return;
    this.disarm();
    const now = this.o.now();
    this.timer = {
      at,
      handle: this.o.timer.set(
        () => {
          this.timer = null;
          this.pump();
        },
        Math.max(0, at - now),
      ),
    };
  }

  private disarm(): void {
    if (this.timer) this.o.timer.clear(this.timer.handle);
    this.timer = null;
  }
}
