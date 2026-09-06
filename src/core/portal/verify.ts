/**
 * Structure verification for the browser-read pages: are the anchors still
 * there, and does the page's structural fingerprint match the one recorded
 * with `make fingerprints`? Run by `schoolsoft-agent browser verify` and the
 * live structure suite. Read-only; drift is reported, never repaired.
 */
import type { BrowserSession } from "../browser/session.js";
import { inspectPage } from "./extractors.js";
import { FINGERPRINTS } from "./fingerprints.js";
import { PAGES, PAGE_KEYS, type PageKey } from "./pages.js";

export type PageStatus = "ok" | "drift" | "broken" | "skipped" | "error";

export interface PageReport {
  page: PageKey;
  path: string;
  web: boolean;
  /** ok: anchors present, fingerprint as recorded (or none recorded); drift: anchors present, fingerprint changed; broken: an anchor is missing. */
  status: PageStatus;
  missing: string[];
  title?: string;
  fingerprint?: string;
  expected?: string;
  reason?: string;
}

export interface VerifyOptions {
  hasWebSession: boolean;
  /** Align the web session's child in focus before the first gated page (the web session has its own). */
  syncWebChild?: () => Promise<void>;
  pages?: readonly PageKey[];
  fingerprints?: Partial<Record<PageKey, { fingerprint: string }>>;
}

export async function verifyPages(
  session: BrowserSession,
  o: VerifyOptions,
): Promise<PageReport[]> {
  const known = o.fingerprints ?? FINGERPRINTS;
  const out: PageReport[] = [];
  let synced = false;
  for (const key of o.pages ?? PAGE_KEYS) {
    const spec = PAGES[key];
    const base = { page: key, path: spec.path, web: spec.web };
    if (spec.web && !o.hasWebSession) {
      out.push({ ...base, status: "skipped", missing: [], reason: "no web session (login --web)" });
      continue;
    }
    try {
      if (spec.web && !synced) {
        await o.syncWebChild?.();
        synced = true;
      }
      const query = spec.exampleQuery
        ? await session.withPage(
            async (page) => {
              await page.goto(PAGES[spec.exampleQuery!.from].path);
              return spec.exampleQuery!.resolve(page);
            },
            { web: PAGES[spec.exampleQuery.from].web },
          )
        : "";
      const r = await session.withPage(
        async (page) => {
          await page.goto(spec.path + query);
          return page.evaluate(inspectPage, [...spec.anchors]);
        },
        { web: spec.web },
      );
      const missing = spec.anchors.filter((a) => (r.anchors[a] ?? 0) === 0);
      const expected = known[key]?.fingerprint;
      const status: PageStatus = missing.length
        ? "broken"
        : expected && expected !== r.fingerprint
          ? "drift"
          : "ok";
      out.push({ ...base, status, missing, title: r.title, fingerprint: r.fingerprint, expected });
    } catch (e) {
      out.push({ ...base, status: "error", missing: [], reason: (e as Error).message });
    }
  }
  return out;
}
