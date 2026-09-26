/** A KeepaliveTimer driven by the test: nothing fires until `fire()` says so, and the clock moves with it. */
import type { KeepaliveTimer } from "../../src/core/index.js";

export class FakeTimer implements KeepaliveTimer {
  private next = 1;
  readonly pending = new Map<number, { run: () => void; ms: number }>();
  /** Every delay ever requested, in order. */
  readonly delays: number[] = [];
  cleared = 0;
  t: number;

  constructor(start = 1_900_000_000_000) {
    this.t = start;
  }

  readonly now = (): number => this.t;

  set(run: () => void, ms: number): unknown {
    const id = this.next++;
    this.pending.set(id, { run, ms });
    this.delays.push(ms);
    return id;
  }

  clear(handle: unknown): void {
    if (this.pending.delete(handle as number)) this.cleared++;
  }

  /** Fire the oldest pending timer (advancing the clock by its delay) and let its async work settle. */
  async fire(): Promise<void> {
    const [id, entry] = [...this.pending][0] ?? [];
    if (id === undefined) throw new Error("no timer is pending");
    this.pending.delete(id);
    this.t += entry!.ms;
    entry!.run();
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  }
}
