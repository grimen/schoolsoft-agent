/**
 * School lookup port: every provider has some public list of tenants;
 * ranking a query against it is vendor-neutral and lives here.
 */
export interface SchoolEntry {
  name: string;
  /** Tenant identifier the provider needs in URLs / config (SchoolSoft: slug). */
  slug: string;
  orgId: number;
}

export interface RankedSchool extends SchoolEntry {
  score: number;
}

export interface SchoolDirectoryPort {
  find(query: string, limit?: number): Promise<RankedSchool[]>;
}

/** Lowercase, strip diacritics, collapse whitespace. */
export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Rank entries by how well their name matches the query; best first. */
export function rankSchools(entries: SchoolEntry[], query: string, limit = 10): RankedSchool[] {
  const q = normalize(query);
  if (!q) return [];
  const tokens = q.split(" ");
  const out: RankedSchool[] = [];
  for (const e of entries) {
    const n = normalize(e.name);
    let score = 0;
    if (n === q) score = 100;
    else if (n.startsWith(q)) score = 80;
    else if (n.includes(q)) score = 70;
    else {
      const hits = tokens.filter((t) => n.includes(t)).length;
      if (hits === tokens.length) score = 60;
      else if (hits > 0) score = Math.round((30 * hits) / tokens.length);
    }
    if (score > 0) out.push({ ...e, score });
  }
  return out
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "sv"))
    .slice(0, limit);
}
