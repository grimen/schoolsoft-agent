/**
 * Request-budget doubles. `FakeClock` is a clock and a BudgetTimer driven by
 * the test: time moves only with `advance`, which fires due timers in order
 * and lets their async work settle, so nothing really sleeps. `CountingBudget`
 * is a whole RequestBudget that sends everything at once and records each
 * call, for tests that only need to know a request went through a budget.
 */
import {
  PortalBudget,
  type BudgetLimits,
  type BudgetSnapshot,
  type BudgetTimer,
  type OutboundAnswer,
  type OutboundCall,
  type PortalBudgetOptions,
  type RequestBudget,
} from "../../src/core/index.js";

/** Let pending promise chains run (a few macrotask turns). */
export async function settle(turns = 20): Promise<void> {
  for (let i = 0; i < turns; i++) await new Promise((resolve) => setImmediate(resolve));
}

export class FakeClock implements BudgetTimer {
  private next = 1;
  private readonly timers = new Map<number, { at: number; run: () => void }>();
  t: number;

  constructor(start = 1_900_000_000_000) {
    this.t = start;
  }

  readonly now = (): number => this.t;

  set(run: () => void, ms: number): unknown {
    const id = this.next++;
    this.timers.set(id, { at: this.t + Math.max(0, ms), run });
    return id;
  }

  clear(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  get pending(): number {
    return this.timers.size;
  }

  /** Move time forward by `ms`, firing every timer that falls due, in order. */
  async advance(ms: number): Promise<void> {
    const end = this.t + ms;
    await settle();
    for (;;) {
      const due = [...this.timers].filter(([, e]) => e.at <= end).sort((a, b) => a[1].at - b[1].at);
      if (due.length === 0) break;
      const [id, entry] = due[0];
      this.timers.delete(id);
      this.t = Math.max(this.t, entry.at);
      entry.run();
      await settle();
    }
    this.t = end;
    await settle();
  }
}

export const GENEROUS: BudgetLimits = { perMinute: 60, burst: 20, maxInFlight: 4 };

/** A production PortalBudget on a fake clock. */
export function fakeBudget(
  clock: FakeClock,
  limits: Partial<BudgetLimits> = {},
  extra: Partial<PortalBudgetOptions> = {},
): PortalBudget {
  return new PortalBudget({
    limits: { perMinute: 20, burst: 10, maxInFlight: 2, ...limits },
    now: clock.now,
    timer: clock,
    ...extra,
  });
}

export class CountingBudget implements RequestBudget {
  readonly calls: OutboundCall[] = [];
  readonly answers: OutboundAnswer[] = [];

  async run<T>(
    call: OutboundCall,
    send: () => Promise<T>,
    read: (answer: T) => OutboundAnswer,
  ): Promise<T> {
    this.calls.push(call);
    const answer = await send();
    this.answers.push(read(answer));
    return answer;
  }

  snapshot(): BudgetSnapshot {
    return { breaker: "closed", retryAt: null, inFlight: 0, queued: 0, limits: { ...GENEROUS } };
  }
}

/** A provider HTTP helper for objects that must not send anything in the test at hand. */
export const noRequests = async (url: string): Promise<never> => {
  throw new Error(`no request expected in this test (${url})`);
};

/** A BudgetTimer that never fires: for budgets in tests where no request may wait. */
export const idleTimer: BudgetTimer = { set: () => 0, clear: () => {} };
