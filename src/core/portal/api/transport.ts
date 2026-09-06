/**
 * HTTP transport shared by the API backends: one place for the base URL,
 * the mobile user agent, JSON handling and the status → error mapping.
 * The fetch function is injectable, so every backend is unit-testable.
 */
import { schoolsoftFetch, ssUrl } from "@elias4044/ssp-node";

/** Minimal shape of ssp-node's schoolsoftFetch, injectable for tests. */
export type ApiFetch = (
  url: string,
  school: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    responseType?: "json" | "text" | "buffer";
  },
  userAgent?: string,
) => Promise<{ status: number; data: unknown }>;

const MOBILE_UA = "SchoolSoftPlus-Mobile/1.0";

export class SchoolsoftHttp {
  private readonly fetchImpl: ApiFetch;
  constructor(
    readonly school: string,
    fetchImpl?: ApiFetch,
  ) {
    this.fetchImpl = fetchImpl ?? (schoolsoftFetch as ApiFetch);
  }

  /** JSON GET; 401/403 and other non-200 statuses become errors naming the path. */
  async get<T>(path: string, headers: Record<string, string>): Promise<T> {
    const r = await this.fetchImpl(
      ssUrl(this.school, path),
      this.school,
      { headers: { ...headers, Accept: "application/json" }, responseType: "json" },
      MOBILE_UA,
    );
    return this.unwrap<T>(r, path);
  }

  /** JSON POST with cookies, for the legacy /rest endpoints' READ queries only. */
  async postJson<T>(path: string, cookie: string, body: unknown): Promise<T> {
    const r = await this.fetchImpl(
      ssUrl(this.school, path),
      this.school,
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          Accept: "application/json",
          "Content-Type": "application/json;charset=UTF-8",
        },
        body: JSON.stringify(body),
        responseType: "json",
      } as never,
      MOBILE_UA,
    );
    return this.unwrap<T>(r, path);
  }

  /** Body-less PUT with cookies; returns the status for the caller to judge. */
  async put(path: string, cookie: string): Promise<number> {
    const r = await this.fetchImpl(
      ssUrl(this.school, path),
      this.school,
      {
        method: "PUT",
        headers: { Cookie: cookie, Accept: "application/json" },
        responseType: "text",
      } as never,
      MOBILE_UA,
    );
    return r.status;
  }

  private unwrap<T>(r: { status: number; data: unknown }, path: string): T {
    if (r.status === 401 || r.status === 403)
      throw new Error(`SchoolSoft rejected the session (HTTP ${r.status}) for ${path}.`);
    if (r.status !== 200) throw new Error(`SchoolSoft returned HTTP ${r.status} for ${path}.`);
    return r.data as T;
  }
}
