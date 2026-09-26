/**
 * The one way this provider reaches SchoolSoft: every request helper here
 * sends through the process's RequestBudget (core/budget), which limits
 * rate and parallelism, pauses after push-back and fails fast while the
 * portal is pushing back. This is the only module that imports ssp-node's
 * `schoolsoftFetch` or calls `fetch`; `make boundaries` refuses both
 * anywhere else. The provider's entry points (index.ts) wrap whatever fetch
 * they are given, an injected test fake included, so tests exercise the
 * same budget production does. Only the answer shapes are SchoolSoft's; the
 * policy is core's.
 */
import { schoolsoftFetch } from "@elias4044/ssp-node";
import type { OutboundAnswer, RequestBudget } from "../../core/budget/budget.js";
import { guardNetwork, UpstreamError } from "../../core/errors/index.js";
import { SCHOOLSOFT_ORIGIN } from "./web-login.js";

export interface FetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  followRedirects?: boolean;
  responseType?: "json" | "text" | "buffer";
  /** Cancellation of the host request; consumed by the budget, never sent. */
  signal?: AbortSignal;
  /** The request changes data (the absence report); consumed by the budget, never sent. */
  write?: boolean;
}

export interface FetchResult {
  status: number;
  data: unknown;
  headers: Record<string, string | string[] | undefined>;
  setCookies: string[];
}

/** ssp-node's schoolsoftFetch, as the provider's backends call it (and tests fake it). */
export type SchoolsoftFetch = (
  url: string,
  school: string,
  options: FetchOptions,
  userAgent?: string,
) => Promise<FetchResult>;

type Raw = (
  url: string,
  school: string,
  options: Omit<FetchOptions, "signal" | "write">,
  userAgent?: string,
) => Promise<{ status: number; headers?: Record<string, string | string[] | undefined> }>;

function header(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string,
): string | null {
  const value = headers?.[name];
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

const answerOf = (r: {
  status: number;
  headers?: Record<string, string | string[] | undefined>;
}): OutboundAnswer => ({ status: r.status, retryAfter: header(r.headers, "retry-after") });

/**
 * The provider's HTTP helper behind the budget. `raw` is a test fake or,
 * by default, ssp-node's schoolsoftFetch.
 */
export function budgetedFetch(budget: RequestBudget, raw?: unknown): SchoolsoftFetch {
  /* c8 ignore next: live default, exercised by make e2e (A1) */
  const send = (raw ?? schoolsoftFetch) as Raw;
  return (url, school, options, userAgent) => {
    const { signal, write, ...sent } = options;
    return budget.run(
      { signal, write },
      () => send(url, school, sent, userAgent),
      answerOf,
    ) as Promise<FetchResult>;
  };
}

/** The part of a WHATWG fetch response the public helpers read. */
interface PlainResponse {
  status: number;
  headers?: { get(name: string): string | null };
}
type PlainInit = { method?: string; headers?: Record<string, string> };
/** WHATWG fetch as the HEAD probe uses it; tests fake it. */
export type HeadFetch = (url: string, init: PlainInit) => Promise<PlainResponse>;
/** WHATWG fetch as the JSON GET uses it; tests fake it. */
export type JsonFetch = (
  url: string,
  init: PlainInit,
) => Promise<PlainResponse & { ok: boolean; json(): Promise<unknown> }>;

const plainAnswer = (r: PlainResponse): OutboundAnswer => ({
  status: r.status,
  retryAfter: r.headers?.get("retry-after") ?? null,
});

/** JSON GET of a public, unauthenticated resource (the school list), behind the budget. */
export function budgetedJson(
  budget: RequestBudget,
  raw: JsonFetch = (url, init) => fetch(url, init),
): (url: string) => Promise<unknown> {
  return async (url) => {
    const res = await guardNetwork(() =>
      budget.run({}, () => raw(url, { headers: { Accept: "application/json" } }), plainAnswer),
    );
    if (!res.ok) throw new UpstreamError(res.status, "the public school list");
    return res.json();
  };
}

/** One HEAD of the portal's front page, behind the budget; resolves with the status. */
export async function budgetedHead(
  budget: RequestBudget,
  raw: HeadFetch = (url, init) => fetch(url, init),
): Promise<number> {
  const res = await budget.run(
    {},
    () => raw(`${SCHOOLSOFT_ORIGIN}/`, { method: "HEAD" }),
    plainAnswer,
  );
  return res.status;
}
