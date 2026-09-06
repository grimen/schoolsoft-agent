/**
 * Public school directory: SchoolSoft publishes every tenant/school with
 * its orgId (~3400 entries, no auth). Used so a parent can configure by
 * school name instead of knowing the URL slug.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

export const SCHOOL_LIST_URL = "https://sms.schoolsoft.se/internal/rest-api/login/schoollist";

import {
  rankSchools,
  type RankedSchool,
  type SchoolDirectoryPort,
  type SchoolEntry,
} from "../../core/school-directory.js";
export type { SchoolEntry, RankedSchool } from "../../core/school-directory.js";

/** Parse the raw schoollist payload; tolerant of wrapper objects. */
export function parseSchoolList(raw: unknown): SchoolEntry[] {
  const arr: unknown[] = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object"
      ? ((Object.values(raw as Record<string, unknown>).find(Array.isArray) as
          unknown[] | undefined) ?? [])
      : [];
  const out: SchoolEntry[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name : null;
    const orgId = typeof r.orgId === "number" ? r.orgId : null;
    const evaUrl = typeof r.evaUrl === "string" ? r.evaUrl : null;
    const slug = evaUrl ? /sms\.schoolsoft\.se\/([^/]+)\//.exec(evaUrl)?.[1] : undefined;
    if (name && orgId !== null && slug) out.push({ name, slug, orgId });
  }
  return out;
}

export interface SchoolDirectoryOptions {
  cacheFile: string;
  ttlMs?: number;
  fetchImpl?: (url: string) => Promise<unknown>;
  now?: () => number;
}

interface CacheShape {
  fetchedAt: number;
  schools: SchoolEntry[];
}

export async function defaultFetch(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`School list request failed: HTTP ${res.status}`);
  return res.json();
}

export class SchoolDirectory implements SchoolDirectoryPort {
  private readonly ttlMs: number;
  private readonly fetchImpl: (url: string) => Promise<unknown>;
  private readonly now: () => number;

  constructor(private readonly o: SchoolDirectoryOptions) {
    this.ttlMs = o.ttlMs ?? 24 * 60 * 60 * 1000;
    this.fetchImpl = o.fetchImpl ?? defaultFetch;
    this.now = o.now ?? Date.now;
  }

  private readCache(): CacheShape | null {
    try {
      if (!existsSync(this.o.cacheFile)) return null;
      const c = JSON.parse(readFileSync(this.o.cacheFile, "utf8")) as CacheShape;
      return Array.isArray(c.schools) && typeof c.fetchedAt === "number" ? c : null;
    } catch {
      return null;
    }
  }

  private writeCache(schools: SchoolEntry[]): void {
    mkdirSync(dirname(this.o.cacheFile), { recursive: true });
    writeFileSync(
      this.o.cacheFile,
      JSON.stringify({ fetchedAt: this.now(), schools } satisfies CacheShape),
    );
  }

  /** All schools, from cache when fresh; falls back to a stale cache if the fetch fails. */
  async list(): Promise<SchoolEntry[]> {
    const cached = this.readCache();
    if (cached && this.now() - cached.fetchedAt < this.ttlMs) return cached.schools;
    try {
      const schools = parseSchoolList(await this.fetchImpl(SCHOOL_LIST_URL));
      if (schools.length === 0) throw new Error("School list was empty");
      this.writeCache(schools);
      return schools;
    } catch (e) {
      if (cached) return cached.schools;
      throw e;
    }
  }

  async find(query: string, limit = 10): Promise<RankedSchool[]> {
    return rankSchools(await this.list(), query, limit);
  }
}
