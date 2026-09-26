/**
 * ReadCache: the port for short-lived copies of portal reads. The contract
 * is part of the safety story, so every implementation must honour it:
 * values are isolated copies, entries expire, the size is bounded, `clear`
 * starts a new epoch (so a read that was in flight across a login, logout
 * or child switch is not stored), and nothing is ever written to disk:
 * children's data lives encrypted in the session store or not at all.
 */
export interface ReadCache {
  /** A copy of the live entry, undefined when absent or expired. */
  get(key: string): unknown;
  set(key: string, value: unknown, ttlMs: number): void;
  clear(): void;
  /** Increases on every clear. */
  epoch(): number;
  size(): number;
}

export const DEFAULT_CACHE_ENTRIES = 200;

/** In-memory, least-recently-used, bounded. The production default. */
export class MemoryReadCache implements ReadCache {
  private readonly entries = new Map<string, { value: unknown; expiresAt: number }>();
  private generation = 0;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxEntries = DEFAULT_CACHE_ENTRIES,
  ) {}

  get(key: string): unknown {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    if (entry.expiresAt <= this.now()) return undefined;
    this.entries.set(key, entry); // most recently used goes last
    return structuredClone(entry.value);
  }

  set(key: string, value: unknown, ttlMs: number): void {
    if (ttlMs <= 0) return;
    const now = this.now();
    for (const [k, e] of this.entries) if (e.expiresAt <= now) this.entries.delete(k);
    this.entries.delete(key);
    this.entries.set(key, { value: structuredClone(value), expiresAt: now + ttlMs });
    while (this.entries.size > this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value as string);
    }
  }

  clear(): void {
    this.entries.clear();
    this.generation++;
  }

  epoch(): number {
    return this.generation;
  }

  size(): number {
    return this.entries.size;
  }
}
