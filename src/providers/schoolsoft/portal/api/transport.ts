/**
 * HTTP transport shared by the API backends: one place for the base URL,
 * the mobile user agent, JSON handling and the status → error mapping.
 * The fetch function is required: in production it is the budgeted one
 * from net.ts (the provider's entry points build it), in unit tests a fake.
 */
import { ssUrl } from "@elias4044/ssp-node";
import { guardNetwork, UpstreamError } from "../../../../core/errors/index.js";

/** Minimal shape of the provider's HTTP helper (net.ts `SchoolsoftFetch`), injectable for tests. */
export type ApiFetch = (
  url: string,
  school: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    followRedirects?: boolean;
    responseType?: "json" | "text" | "buffer";
    /** The host request's cancellation, for the budget's queue. */
    signal?: AbortSignal;
    /** Marks the one kind of request that changes data, for the budget. */
    write?: boolean;
  },
  userAgent?: string,
) => Promise<{ status: number; data: unknown }>;

const MOBILE_UA = "SchoolSoftPlus-Mobile/1.0";

export class SchoolsoftHttp {
  constructor(
    readonly school: string,
    private readonly fetchImpl: ApiFetch,
    private readonly beforeRead?: () => void,
    private readonly signal?: AbortSignal,
  ) {}

  /** JSON GET; 401/403 and other non-200 statuses become errors naming the path. */
  async get<T>(path: string, headers: Record<string, string>): Promise<T> {
    this.beforeRead?.();
    const r = await guardNetwork(() =>
      this.fetchImpl(
        ssUrl(this.school, path),
        this.school,
        {
          headers: { ...headers, Accept: "application/json" },
          responseType: "json",
          signal: this.signal,
        },
        MOBILE_UA,
      ),
    );
    return this.unwrap<T>(r, path);
  }

  /** JSON POST with cookies for READ queries (legacy /rest endpoints); writes use postWrite. */
  async postJson<T>(path: string, cookie: string, body: unknown): Promise<T> {
    return this.unwrap<T>(await this.post(path, cookie, body), path);
  }

  /**
   * JSON POST that changes data. Sends once; any 2xx is success (the write
   * endpoints' success status is not verified), anything else an UpstreamError.
   * Callers decide what a failure means for a request that may have arrived.
   */
  async postWrite(
    path: string,
    cookie: string,
    body: unknown,
  ): Promise<{ status: number; data: unknown }> {
    // The HTTP helper re-issues a POST when it follows a 301/302/307/308;
    // a write must reach the network once, so redirects are not followed.
    const r = await this.post(path, cookie, body, { followRedirects: false, write: true });
    if (r.status < 200 || r.status > 299) throw new UpstreamError(r.status, path);
    return r;
  }

  private post(
    path: string,
    cookie: string,
    body: unknown,
    extra: { followRedirects?: false; write?: true } = {},
  ) {
    return guardNetwork(() =>
      this.fetchImpl(
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
          signal: this.signal,
          ...extra,
        },
        MOBILE_UA,
      ),
    );
  }

  /** Body-less PUT with cookies; returns the status for the caller to judge. */
  async put(path: string, cookie: string): Promise<number> {
    const r = await guardNetwork(() =>
      this.fetchImpl(
        ssUrl(this.school, path),
        this.school,
        {
          method: "PUT",
          headers: { Cookie: cookie, Accept: "application/json" },
          responseType: "text",
          signal: this.signal,
        },
        MOBILE_UA,
      ),
    );
    return r.status;
  }

  private unwrap<T>(r: { status: number; data: unknown }, path: string): T {
    if (r.status !== 200) throw new UpstreamError(r.status, path);
    return r.data as T;
  }
}
