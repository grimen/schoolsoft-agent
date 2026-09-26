/**
 * Accounts: one login to one school portal tenant, keyed `<provider>:<school>`.
 * Pure: no filesystem, no environment. Persisted documents that hold one
 * entry per account share the helpers below; each file decides what an
 * entry is. See docs/planning/specs/2026-09-26-accounts-by-school.md.
 */
import type { Config } from "./config.js";

/** The provider an account without one belongs to (every file written before the provider seam). */
export const DEFAULT_PROVIDER = "schoolsoft";

/** The key of the account a login to `school` at `provider` belongs to, e.g. `schoolsoft:taby`. */
export function accountKey(provider: string | undefined, school: string): string {
  return `${provider || DEFAULT_PROVIDER}:${school}`;
}

/** The current account of a resolved Config. */
export function accountKeyOf(config: Pick<Config, "provider" | "school">): string {
  return accountKey(config.provider, config.school);
}

/** A document with one entry per account. */
export interface AccountsDocument<T> {
  accounts: Record<string, T>;
}

export function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}

/** The entries of a keyed document; none when it has no usable `accounts`. */
export function accountsOf<T>(doc: unknown): Record<string, T> {
  return isRecord(doc) && isRecord(doc.accounts) ? (doc.accounts as Record<string, T>) : {};
}

/** One account's entry, if it has one (own keys only). */
export function entryOf<T>(doc: unknown, account: string): T | undefined {
  const accounts = accountsOf<T>(doc);
  return Object.hasOwn(accounts, account) ? accounts[account] : undefined;
}

/** The document with that account's entry set; every other entry and field kept. */
export function withAccount<D extends object, T>(
  doc: D,
  account: string,
  value: T,
): D & AccountsDocument<T> {
  return { ...doc, accounts: { ...accountsOf<T>(doc), [account]: value } };
}

/** The document without that account's entry. */
export function withoutAccount<D extends object, T>(
  doc: D,
  account: string,
): D & AccountsDocument<T> {
  const { [account]: _gone, ...rest } = accountsOf<T>(doc);
  return { ...doc, accounts: rest };
}
