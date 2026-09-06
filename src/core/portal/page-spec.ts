/**
 * A page the browser provider reads, declared once by a provider: path,
 * whether it sits behind a login gate that needs the web-login cookies,
 * and the anchors a healthy page must contain. `browser verify`, the live
 * structure suite and `make fingerprints` work from these declarations.
 */
import type { PortalPage } from "../browser/session.js";

export interface PageSpec {
  /** Path under the tenant, without query. */
  readonly path: string;
  /** Only reachable with the web-login cookies (the provider's "log in again" gate). */
  readonly web: boolean;
  /** Selectors that must match at least once on a healthy page. */
  readonly anchors: readonly string[];
  /**
   * Query string a verification visit needs (pages that render nothing
   * without a parameter), resolved on another page visited with that page's
   * own session.
   */
  readonly exampleQuery?: {
    readonly from: string;
    readonly resolve: (page: PortalPage) => Promise<string>;
  };
}

export type PageMap = Record<string, PageSpec>;

export interface PageFingerprint {
  fingerprint: string;
  recordedAt: string;
}
