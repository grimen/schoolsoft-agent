/**
 * The one way this provider reaches SchoolSoft: every request helper here
 * sends through the process's RequestBudget (core/budget), which limits
 * rate and parallelism, pauses after push-back and fails fast while the
 * portal is pushing back. This is the only module that calls `fetch`;
 * `make boundaries` refuses it anywhere else, and the one-request sender is
 * not exported. The provider's entry points (index.ts) wrap whatever sender
 * they are given, an injected test fake included, so tests exercise the
 * same budget and redirect rules production does. Only the answer shapes
 * are SchoolSoft's; the policy is core's.
 */
import type { OutboundAnswer, RequestBudget } from "../../core/budget/budget.js";
import { guardNetwork, UpstreamError } from "../../core/errors/index.js";
import { SCHOOLSOFT_ORIGIN } from "./web-login.js";

/** What one request asks of the portal. */
export interface SendOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** How to read the answer's body: JSON (null when it is not JSON, the default) or text. */
  responseType?: "json" | "text";
}

/**
 * What a request does with a 3xx answer, said on every request. "manual"
 * hands it back (status and `location`). "follow" follows it like WHATWG
 * fetch (303, and 301/302 after a POST, become a GET without body; 307/308
 * repeat the request), only to the same origin and at most MAX_REDIRECTS
 * times, each hop its own request through the budget. A write is never
 * followed: it must reach the portal once, and what a redirect after it
 * means is the write's to decide.
 */
export type Redirect = "follow" | "manual";

export type FetchOptions = SendOptions & {
  /** Cancellation of the host request; consumed by the budget, never sent. */
  signal?: AbortSignal;
} & (
    | { redirect: Redirect; write?: false }
    /** The request changes data (the absence report); consumed by the budget, never sent. */
    | { redirect: "manual"; write: true }
  );

export interface FetchResult {
  status: number;
  data: unknown;
  /** Lower-case names; `set-cookie` is in `setCookies`, not here. */
  headers: Record<string, string | string[] | undefined>;
  setCookies: string[];
}

/** The provider's HTTP helper, as its backends call it (and tests fake it). */
export type SchoolsoftFetch = (
  url: string,
  school: string,
  options: FetchOptions,
  userAgent: string,
) => Promise<FetchResult>;

/** One request, never following a redirect: the live sender below, or a test fake. */
type Send = (
  url: string,
  school: string,
  options: SendOptions,
  userAgent: string,
) => Promise<{ status: number; headers?: Record<string, string | string[] | undefined> }>;

/** The most redirects one request follows. */
export const MAX_REDIRECTS = 5;

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

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * The live sender: one request with the portal's usual `Referer` and
 * `Origin` and the caller's user agent. `redirect: "manual"` makes fetch
 * hand every 3xx back; following is budgetedFetch's decision, per request.
 */
async function sendToPortal(
  url: string,
  school: string,
  options: SendOptions,
  userAgent: string,
): Promise<FetchResult> {
  const res = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      "User-Agent": userAgent,
      Referer: `${SCHOOLSOFT_ORIGIN}/${school}/`,
      Origin: SCHOOLSOFT_ORIGIN,
      ...options.headers,
    },
    body: options.body,
    redirect: "manual",
  });
  const text = await res.text();
  const headers: Record<string, string> = {};
  res.headers.forEach((value, name) => {
    if (name !== "set-cookie") headers[name] = value;
  });
  return {
    status: res.status,
    data: options.responseType === "text" ? text : parseJson(text),
    headers,
    setCookies: res.headers.getSetCookie(),
  };
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/** The next hop of a followed redirect, or null when the answer is the answer. */
function nextHop(
  url: string,
  request: SendOptions,
  answer: { status: number; headers?: Record<string, string | string[] | undefined> },
): { url: string; request: SendOptions } | null {
  const location = header(answer.headers, "location");
  if (!REDIRECTS.has(answer.status) || !location || !URL.canParse(location, url)) return null;
  const next = new URL(location, url);
  // Cookies and the app token are for SchoolSoft only: another host gets nothing.
  if (next.origin !== new URL(url).origin) return null;
  const post = (request.method ?? "GET").toUpperCase() === "POST";
  const asGet = answer.status === 303 || (post && (answer.status === 301 || answer.status === 302));
  if (!asGet) return { url: next.href, request };
  const { body: _body, headers, ...rest } = request;
  const kept = headers
    ? Object.fromEntries(
        Object.entries(headers).filter(([k]) => k.toLowerCase() !== "content-type"),
      )
    : undefined;
  return { url: next.href, request: { ...rest, method: "GET", ...(kept && { headers: kept }) } };
}

/**
 * The provider's HTTP helper behind the budget. `raw` is a test fake or,
 * by default, the live sender. Every hop of a followed redirect is one
 * request through the budget; a write is sent once and never followed.
 */
export function budgetedFetch(budget: RequestBudget, raw?: unknown): SchoolsoftFetch {
  const send = (raw ?? sendToPortal) as Send;
  return async (url, school, options, userAgent) => {
    const { signal, write, redirect, ...sent } = options;
    const follow = redirect === "follow" && !write; // a write is never followed, whatever the caller says
    let hop = { url, request: sent as SendOptions };
    for (let hops = 0; ; hops++) {
      const answer = await budget.run(
        { signal, write },
        () => send(hop.url, school, hop.request, userAgent),
        answerOf,
      );
      const next = follow && hops < MAX_REDIRECTS ? nextHop(hop.url, hop.request, answer) : null;
      if (!next) return answer as FetchResult;
      hop = next;
    }
  };
}

/** The part of a WHATWG fetch response the public helpers read. */
interface PlainResponse {
  status: number;
  headers?: { get(name: string): string | null };
}
/**
 * These two carry no cookie or token, so they let fetch follow a redirect
 * itself (said explicitly); the whole chain is one request to the budget.
 */
type PlainInit = { method?: string; headers?: Record<string, string>; redirect: "follow" };
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
      budget.run(
        {},
        () => raw(url, { headers: { Accept: "application/json" }, redirect: "follow" }),
        plainAnswer,
      ),
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
    () => raw(`${SCHOOLSOFT_ORIGIN}/`, { method: "HEAD", redirect: "follow" }),
    plainAnswer,
  );
  return res.status;
}
