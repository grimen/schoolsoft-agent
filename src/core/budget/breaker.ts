/**
 * The push-back half of the request budget: after a 429, a 5xx or a network
 * failure it pauses (honouring Retry-After), and after repeated push-back it
 * opens: requests fail at once, background work sends nothing, and after a
 * cool-down exactly one real user request goes through as the probe. An
 * answer closes it; push-back reopens it with a longer cool-down. Pure state
 * over an injected "now"; it never retries anything itself.
 */
import type { BreakerPolicy } from "./policy.js";

export type BreakerState = "closed" | "open" | "half_open";

/** What a request about to go out may do. */
export type Admission =
  | { kind: "go"; probe: boolean }
  | { kind: "wait"; until: number }
  | { kind: "refuse"; reason: "slow_down" | "paused"; retryAt: number };

export class Breaker {
  private current: BreakerState = "closed";
  /** Push-backs since the last success, within the window. */
  private failures: number[] = [];
  private consecutive = 0;
  private pausedUntil = 0;
  private openUntil = 0;
  private coolDownMs: number;
  private probing = false;

  constructor(private readonly p: BreakerPolicy) {
    this.coolDownMs = p.coolDownMs;
  }

  state(now: number): BreakerState {
    if (this.current === "open" && now >= this.openUntil) {
      this.current = "half_open";
      this.probing = false;
    }
    return this.current;
  }

  /** When requests may flow again: the end of a cool-down or a pause; null when they flow now. */
  retryAt(now: number): number | null {
    const state = this.state(now);
    if (state === "open") return this.openUntil;
    if (state === "closed" && this.pausedUntil > now) return this.pausedUntil;
    return null;
  }

  admit(now: number, call: { write: boolean; background: boolean }): Admission {
    const state = this.state(now);
    if (state === "open") return { kind: "refuse", reason: "paused", retryAt: this.openUntil };
    if (state === "half_open") {
      // Exactly one real user read tests the water; writes and background work never do.
      if (this.probing || call.write || call.background)
        return { kind: "refuse", reason: "paused", retryAt: now + this.p.probeRetryMs };
      this.probing = true;
      return { kind: "go", probe: true };
    }
    if (this.pausedUntil > now) {
      if (call.background || this.pausedUntil - now > this.p.maxWaitMs)
        return { kind: "refuse", reason: "slow_down", retryAt: this.pausedUntil };
      return { kind: "wait", until: this.pausedUntil };
    }
    return { kind: "go", probe: false };
  }

  /** The probe never went out (cancelled while queued): the next user request may probe instead. */
  abandon(probe: boolean): void {
    if (probe) this.probing = false;
  }

  success(probe: boolean): void {
    if (probe) {
      this.current = "closed";
      this.probing = false;
      this.coolDownMs = this.p.coolDownMs;
    }
    this.failures = [];
    this.consecutive = 0;
  }

  /** A 429, a 5xx or a network failure; `retryAfterMs` from the answer when it said. */
  pushback(now: number, probe: boolean, retryAfterMs: number | null): void {
    const hinted =
      retryAfterMs === null
        ? null
        : Math.min(this.p.maxRetryAfterMs, Math.max(this.p.minRetryAfterMs, retryAfterMs));
    if (probe) {
      this.probing = false;
      this.coolDownMs = Math.min(this.p.maxCoolDownMs, this.coolDownMs * 2);
      return this.open(now, hinted);
    }
    if (this.state(now) !== "closed") {
      // An answer to a request sent before the breaker opened: only a longer Retry-After counts.
      if (this.current === "open" && hinted !== null)
        this.openUntil = Math.max(this.openUntil, now + hinted);
      return;
    }
    this.failures = this.failures.filter((at) => now - at < this.p.windowMs);
    this.failures.push(now);
    this.consecutive++;
    if (this.failures.length >= this.p.threshold) return this.open(now, hinted);
    const backoff = Math.min(
      this.p.backoffMaxMs,
      this.p.backoffBaseMs * 2 ** (this.consecutive - 1),
    );
    this.pausedUntil = Math.max(this.pausedUntil, now + (hinted ?? backoff));
  }

  private open(now: number, hinted: number | null): void {
    this.current = "open";
    this.openUntil = now + Math.max(this.coolDownMs, hinted ?? 0);
    this.failures = [];
    this.consecutive = 0;
    this.pausedUntil = 0;
  }
}
