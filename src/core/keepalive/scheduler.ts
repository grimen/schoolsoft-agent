/**
 * Keepalive scheduler for long-lived processes (MCP server, HTTP connector).
 * Opt-in; the one-shot CLI never creates one. Each task is one small request
 * on a timer, run a little early rather than late (jitter), slower after a
 * transient failure (backoff), silent during quiet hours, and stopped for
 * good when the session is gone: only a human login starts it again, so it
 * can never loop against a dead session and never leads to BankID.
 * Timer, clock and randomness are injected.
 */
import { AgentError, isTransient } from "../errors/index.js";

export interface KeepaliveTimer {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export type KeepaliveTaskName = "app" | "web";

export interface KeepaliveTask {
  name: KeepaliveTaskName;
  /** Default pause between runs. */
  intervalMs: number;
  /** Pause before the first run after start/resume; the default pause when absent. */
  firstDelayMs?: number;
  /** One run. Resolves with the pause wanted before the next one, or null for the default. */
  run(): Promise<number | null>;
}

export interface QuietHours {
  /** Local hours 0–23; the span may wrap midnight (22–6). Start inclusive, end exclusive. */
  startHour: number;
  endHour: number;
}

export interface KeepaliveOptions {
  tasks: KeepaliveTask[];
  timer: KeepaliveTimer;
  now: () => number;
  /** 0 ≤ n < 1. */
  random: () => number;
  quietHours?: QuietHours | null;
  /** Local hour of a timestamp; injected so tests do not depend on the time zone. */
  hourOf?: (ms: number) => number;
  log?: (message: string) => void;
}

export type KeepaliveState = "scheduled" | "stopped";

/** Never sooner than this, whatever a task asks for. */
export const MIN_DELAY_MS = 30_000;
export const MAX_BACKOFF_MS = 60 * 60_000;
/** Runs happen up to this fraction early, never late. */
export const JITTER = 0.1;

export function inQuietHours(hour: number, quiet: QuietHours): boolean {
  return quiet.startHour <= quiet.endHour
    ? hour >= quiet.startHour && hour < quiet.endHour
    : hour >= quiet.startHour || hour < quiet.endHour;
}

interface Slot {
  task: KeepaliveTask;
  handle: unknown;
  failures: number;
  state: KeepaliveState;
  /** Bumped on stop/resume so a run that was in flight cannot re-arm a replaced timer. */
  generation: number;
}

export class KeepaliveScheduler {
  private readonly slots = new Map<KeepaliveTaskName, Slot>();
  private readonly hourOf: (ms: number) => number;

  constructor(private readonly o: KeepaliveOptions) {
    this.hourOf = o.hourOf ?? ((ms) => new Date(ms).getHours());
    for (const task of o.tasks) {
      this.slots.set(task.name, {
        task,
        handle: null,
        failures: 0,
        state: "stopped",
        generation: 0,
      });
    }
  }

  start(): void {
    for (const name of this.slots.keys()) this.resume(name);
  }

  /** (Re)start one task, e.g. after the user logged in again. No-op for a task that is not configured. */
  resume(name: KeepaliveTaskName): void {
    const slot = this.slots.get(name);
    if (!slot) return;
    this.halt(slot);
    slot.failures = 0;
    slot.state = "scheduled";
    this.arm(slot, slot.task.firstDelayMs ?? slot.task.intervalMs);
  }

  stop(): void {
    for (const slot of this.slots.values()) this.halt(slot);
  }

  status(): Partial<Record<KeepaliveTaskName, KeepaliveState>> {
    return Object.fromEntries([...this.slots].map(([name, slot]) => [name, slot.state]));
  }

  private halt(slot: Slot): void {
    if (slot.handle !== null) this.o.timer.clear(slot.handle);
    slot.handle = null;
    slot.state = "stopped";
    slot.generation++;
  }

  private arm(slot: Slot, wantedMs: number): void {
    const early = wantedMs * JITTER * this.o.random();
    const delay = Math.max(MIN_DELAY_MS, Math.round(wantedMs - early));
    const generation = slot.generation;
    slot.handle = this.o.timer.set(() => void this.fire(slot, generation), delay);
  }

  private async fire(slot: Slot, generation: number): Promise<void> {
    slot.handle = null;
    const quiet = this.o.quietHours;
    if (quiet && inQuietHours(this.hourOf(this.o.now()), quiet)) {
      this.arm(slot, slot.task.intervalMs); // no request at night; look again later
      return;
    }
    let next: number;
    try {
      next = (await slot.task.run()) ?? slot.task.intervalMs;
      slot.failures = 0;
    } catch (e) {
      if (generation !== slot.generation) return;
      if (!isTransient(e)) {
        // Session gone, nothing to keep alive, or a bug: never retry on our own.
        this.halt(slot);
        this.o.log?.(
          `keepalive: ${slot.task.name} stopped (${e instanceof AgentError ? e.key : "unexpected error"})`,
        );
        return;
      }
      slot.failures++;
      next = Math.min(MAX_BACKOFF_MS, slot.task.intervalMs * 2 ** slot.failures);
    }
    if (generation !== slot.generation) return; // stopped or restarted while running
    this.arm(slot, next);
  }
}
