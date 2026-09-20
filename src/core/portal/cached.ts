/**
 * Read cache in front of a Portal. A Portal method does not name the child
 * it reads (the child in focus is session state), so the key is built from
 * the scope at call time: provider, school, guardian, child in focus, then
 * capability and arguments. A result is stored only when the scope and the
 * cache epoch are the same after the read as before it, so a read that
 * overlapped a child switch, login or logout is returned but never kept.
 */
import type { ReadCache } from "../cache/read-cache.js";
import type { CacheTtls } from "../cache/policy.js";
import { CAPABILITIES, type Capability, type Portal } from "./types.js";

export interface CacheScope {
  provider: string;
  school: string;
  userId: number;
  childId: number;
}

export interface ReadCacheOptions {
  cache: ReadCache;
  ttls: CacheTtls;
  /** Capabilities that must never be cached whatever `ttls` says (the web-session ones). */
  never: readonly Capability[];
  /** Who is reading, and for which child; null (no session yet) bypasses the cache. */
  scope: () => CacheScope | null;
  /** Host authorization; runs before the cache is consulted, and may throw. */
  guard?: () => void;
  /** "refresh" skips the lookup and replaces the entry (`fresh: true`). */
  mode?: "read" | "refresh";
}

/** Arguments as a stable string: undefined and trailing gaps vanish, strings are trimmed. */
export function normalizeArgs(args: readonly unknown[]): string {
  const list = args.map((a) => (a === undefined ? null : typeof a === "string" ? a.trim() : a));
  while (list.length && list[list.length - 1] === null) list.pop();
  return JSON.stringify(list);
}

export function cacheKey(scope: CacheScope, capability: string, args: readonly unknown[]): string {
  return JSON.stringify([
    scope.provider,
    scope.school,
    scope.userId,
    scope.childId,
    capability,
    normalizeArgs(args),
  ]);
}

const sameScope = (a: CacheScope, b: CacheScope | null): boolean =>
  b !== null &&
  a.provider === b.provider &&
  a.school === b.school &&
  a.userId === b.userId &&
  a.childId === b.childId;

export function withReadCache(portal: Portal, o: ReadCacheOptions): Portal {
  const out: Partial<Record<Capability, (...args: unknown[]) => Promise<unknown>>> = {};
  for (const capability of CAPABILITIES) {
    const fn = (portal as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[
      capability
    ];
    const ttl = o.never.includes(capability) ? 0 : (o.ttls[capability] ?? 0);
    out[capability] = async (...args: unknown[]) => {
      if (ttl <= 0) return fn.apply(portal, args);
      o.guard?.();
      const scope = o.scope();
      if (!scope) return fn.apply(portal, args);
      const key = cacheKey(scope, capability, args);
      if (o.mode !== "refresh") {
        const hit = o.cache.get(key);
        if (hit !== undefined) return hit;
      }
      const epoch = o.cache.epoch();
      const value = await fn.apply(portal, args);
      if (value !== undefined && o.cache.epoch() === epoch && sameScope(scope, o.scope())) {
        o.cache.set(key, value, ttl);
      }
      return value;
    };
  }
  return out as unknown as Portal;
}
