/**
 * The numbers of the request budget. The rate, burst and parallelism a
 * provider starts from are its own (`SchoolProvider.requestBudget`) and a
 * configuration may lower or raise them within the bounds here; the breaker
 * and backoff rules are fixed, so no setting can switch the protection off.
 * Reasons for each value: docs/planning/specs/2026-09-26-request-budget.md.
 */

/** How much a process may send: a token bucket (rate, burst) and a cap on requests in flight. */
export interface BudgetLimits {
  /** Sustained rate: tokens added per minute. */
  perMinute: number;
  /** Bucket size: requests that may start back to back after a quiet spell. */
  burst: number;
  /** Requests waiting for an answer at the same time. */
  maxInFlight: number;
}

/** Safety ceilings for configured limits: never more than one a second sustained, 20 at once, 4 in parallel. */
export const BUDGET_BOUNDS: Record<keyof BudgetLimits, { min: number; max: number }> = {
  perMinute: { min: 1, max: 60 },
  burst: { min: 1, max: 20 },
  maxInFlight: { min: 1, max: 4 },
};

export interface BreakerPolicy {
  /** Push-backs within `windowMs`, with no success in between, that open the breaker. */
  threshold: number;
  windowMs: number;
  /** First cool-down; doubles after each failed probe up to `maxCoolDownMs`. */
  coolDownMs: number;
  maxCoolDownMs: number;
  /** Pause after a push-back without Retry-After: base, doubling per consecutive push-back, up to max. */
  backoffBaseMs: number;
  backoffMaxMs: number;
  /** Retry-After is honoured within these limits. */
  minRetryAfterMs: number;
  maxRetryAfterMs: number;
  /** A request waits out a pause that ends within this; a longer one fails at once. */
  maxWaitMs: number;
  /** When a request refused during a probe may try again. */
  probeRetryMs: number;
}

const MINUTE = 60_000;

export const DEFAULT_BREAKER_POLICY: BreakerPolicy = {
  threshold: 3,
  windowMs: 2 * MINUTE,
  coolDownMs: 5 * MINUTE,
  maxCoolDownMs: 60 * MINUTE,
  backoffBaseMs: 2_000,
  backoffMaxMs: MINUTE,
  minRetryAfterMs: 1_000,
  maxRetryAfterMs: 60 * MINUTE,
  maxWaitMs: 10_000,
  probeRetryMs: 10_000,
};
