/**
 * The write framework's preview → confirmation token (#59, "The confirmation token"),
 * reduced to what a host can observe: an opaque `wct_` token stored only as a keyed
 * hash, bound to the exact intent and the caller, valid 10 minutes, sent at most once.
 */
import { createHmac, randomBytes, randomUUID } from "node:crypto";

export type ConfirmOutcome = "sent" | "replayed" | "invalid" | "expired" | "input_changed";
export interface ConfirmResult {
  outcome: ConfirmOutcome;
  writeId?: string;
  secondsSincePreview?: number;
}
interface Pending {
  writeId: string;
  binding: string;
  intentHash: string;
  createdAt: number;
  expiresAt: number;
  sentAt?: number;
}

/** JSON with object keys sorted at every depth. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export class ProbeConfirmations {
  private readonly records = new Map<string, Pending>();
  private readonly key: Buffer;
  private readonly now: () => number;
  private readonly random: (size: number) => Buffer;
  private readonly ttlMs = 10 * 60_000;
  private readonly max: number;
  constructor(
    options: {
      key?: Buffer;
      now?: () => number;
      random?: (size: number) => Buffer;
      max?: number;
    } = {},
  ) {
    this.random = options.random ?? randomBytes;
    this.key = options.key ?? this.random(32);
    this.now = options.now ?? Date.now;
    this.max = options.max ?? 256;
  }
  private hash(value: string): string {
    return createHmac("sha256", this.key).update(value).digest("base64url");
  }
  private prune(): void {
    for (const [key, record] of this.records)
      if (record.expiresAt <= this.now()) this.records.delete(key);
  }
  size(): number {
    return this.records.size;
  }
  preview(
    binding: string,
    intent: unknown,
  ): { writeId: string; confirmation: string; expiresAt: number } {
    this.prune();
    if (this.records.size >= this.max) this.records.delete(this.records.keys().next().value!);
    const confirmation = "wct_" + this.random(32).toString("base64url");
    const createdAt = this.now();
    const record: Pending = {
      writeId: randomUUID(),
      binding,
      intentHash: this.hash(canonical(intent)),
      createdAt,
      expiresAt: createdAt + this.ttlMs,
    };
    this.records.set(this.hash(confirmation), record);
    return { writeId: record.writeId, confirmation, expiresAt: record.expiresAt };
  }
  /** Checked in #59's order: exists, in time, same caller, same intent; then claimed once. */
  confirm(binding: string, intent: unknown, confirmation: string): ConfirmResult {
    const key = this.hash(confirmation);
    const record = this.records.get(key);
    if (!record) return { outcome: "invalid" };
    if (record.expiresAt <= this.now()) {
      this.records.delete(key);
      return { outcome: "expired", writeId: record.writeId };
    }
    if (record.binding !== binding) return { outcome: "invalid" };
    if (record.intentHash !== this.hash(canonical(intent))) {
      this.records.delete(key);
      return { outcome: "input_changed", writeId: record.writeId };
    }
    const outcome = record.sentAt === undefined ? "sent" : "replayed";
    record.sentAt ??= this.now();
    return {
      outcome,
      writeId: record.writeId,
      secondsSincePreview: Math.round((record.sentAt - record.createdAt) / 1000),
    };
  }
}
