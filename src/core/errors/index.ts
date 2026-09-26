/**
 * The error contract every surface renders from. An AgentError says what
 * kind of problem it is (which fixes the exit code and whether a retry can
 * help), which message to show (a key plus parameters, rendered in the
 * user's language) and what to do next (a hint rendered for the surface).
 * Anything that is not an AgentError is a bug and is rendered as such.
 */
import {
  HINTS,
  MESSAGES,
  type HintKey,
  type Lang,
  type MessageKey,
  type Surface,
} from "./messages.js";

export type { Lang, Surface, MessageKey, HintKey } from "./messages.js";
export { MESSAGES, HINTS, detectLang } from "./messages.js";

export type ErrorKind =
  | "not_configured"
  | "not_authenticated"
  | "network"
  | "not_available"
  | "input"
  | "upstream"
  | "internal";

/** Exit codes a skill can branch on; 1 is reserved for bugs. */
export const EXIT_CODE_BY_KIND: Record<ErrorKind, number> = {
  internal: 1,
  not_authenticated: 2,
  not_configured: 3,
  network: 4,
  not_available: 5,
  input: 6,
  upstream: 7,
};

export class AgentError extends Error {
  readonly kind: ErrorKind;
  readonly key: MessageKey;
  readonly params: Record<string, string>;
  readonly hint?: HintKey;
  /** True when the same call may succeed if repeated (network, upstream 5xx). */
  readonly retryable: boolean;

  constructor(o: {
    kind: ErrorKind;
    key: MessageKey;
    params?: Record<string, string | number | undefined | null>;
    hint?: HintKey;
    retryable?: boolean;
    cause?: unknown;
  }) {
    const params = Object.fromEntries(
      Object.entries(o.params ?? {}).map(([k, v]) => [
        k,
        v === undefined || v === null ? "" : String(v),
      ]),
    );
    super(MESSAGES[o.key].en(params), o.cause !== undefined ? { cause: o.cause } : undefined);
    this.name = new.target.name;
    this.kind = o.kind;
    this.key = o.key;
    this.params = params;
    this.hint = o.hint;
    this.retryable = o.retryable ?? false;
  }
}

/** Something outside the program failed to connect: DNS, TCP, TLS, timeout. */
export class NetworkError extends AgentError {
  constructor(detail: string, cause?: unknown) {
    super({
      kind: "network",
      key: "network",
      params: { detail },
      hint: "retry",
      retryable: true,
      cause,
    });
  }
}

/** SchoolSoft answered, but not with success. 401/403 mark the session as rejected. */
export class UpstreamError extends AgentError {
  readonly status: number;
  readonly sessionRejected: boolean;
  constructor(status: number, what: string) {
    const rejected = status === 401 || status === 403;
    super({
      kind: rejected ? "not_authenticated" : "upstream",
      key: rejected ? "upstream_rejected" : "upstream",
      params: { status, what },
      hint: rejected ? "login" : "retry",
      retryable: !rejected && status >= 500,
    });
    this.status = status;
    this.sessionRejected = rejected;
  }
}

/**
 * The request budget refused or stopped a request because the school portal
 * pushed back (HTTP 429, 5xx or network failures). `slow_down`: one push-back
 * asked for a pause (a 429 answer, or a pause too long to wait out). `paused`:
 * the circuit breaker is open or testing the water. `retryAt` (epoch ms) is
 * when requests may flow again; `sent` says whether this request reached the
 * portal (only a 429 answer did). Transient: a saved session is never cleared.
 */
export class PortalPushbackError extends AgentError {
  readonly reason: "slow_down" | "paused";
  readonly retryAt: number;
  readonly sent: boolean;
  constructor(o: { reason: "slow_down" | "paused"; retryAt: number; now: number; sent: boolean }) {
    super({
      kind: "upstream",
      key: o.reason === "paused" ? "portal_paused" : "portal_slow_down",
      params: { seconds: Math.max(1, Math.ceil((o.retryAt - o.now) / 1000)) },
      hint: "portal_pushback",
      retryable: true,
    });
    this.reason = o.reason;
    this.retryAt = o.retryAt;
    this.sent = o.sent;
  }
}

/** The caller gave up (its request was cancelled) while the request waited in the budget's queue. */
export class RequestCancelledError extends AgentError {
  constructor() {
    super({ kind: "input", key: "request_cancelled" });
  }
}

/** Bad arguments from the caller (agent or human). */
export class InputError extends AgentError {
  constructor(detail: string) {
    super({ kind: "input", key: "input", params: { detail }, hint: "fix_input" });
  }
}

/**
 * The portal answered, but in a shape the provider cannot map to the domain
 * model, or an operation's result failed its declared output schema. Nothing
 * is returned: bad data is never passed on. `where` is the capability or
 * operation that noticed; `runOperation` names the operation the user ran.
 * The detail holds field paths and issue codes only, never values, so no
 * child's data reaches a message or a log.
 */
export class ResponseDriftError extends AgentError {
  readonly where: string;
  readonly detail: string;
  readonly operation?: string;
  constructor(where: string, detail: string, operation?: string) {
    super({
      kind: "upstream",
      key: "response_drift",
      params: {
        operation: operation ?? where,
        detail: operation === undefined || operation === where ? detail : `${where}: ${detail}`,
      },
      hint: "update_or_report",
    });
    this.where = where;
    this.detail = detail;
    this.operation = operation;
  }

  /** The same drift, named after the operation the user ran (kept if already named). */
  forOperation(name: string): ResponseDriftError {
    return this.operation !== undefined
      ? this
      : new ResponseDriftError(this.where, this.detail, name);
  }
}

/** Zod-style issues as "path code" pairs, without the values that failed. */
export function describeIssues(
  issues: readonly { path: readonly PropertyKey[]; code: string; message: string }[],
): string {
  const shown = issues
    .slice(0, 3)
    .map(
      (i) =>
        `${i.path.map(String).join(".") || "(root)"} ${i.code === "custom" ? i.message : i.code}`,
    );
  const more = issues.length > 3 ? ` (+${issues.length - 3} more)` : "";
  return shown.join(", ") + more;
}

/**
 * A failure that says nothing about the session: the network, or the portal
 * answering 5xx. Saved sessions are kept and keepalive backs off, because
 * throwing a session away would cost the user a BankID round for a wifi blip.
 */
export function isTransient(e: unknown): boolean {
  return (
    e instanceof AgentError && (e.kind === "network" || (e.kind === "upstream" && e.retryable))
  );
}

/**
 * Failures after which a saved session must be kept: transient ones, and
 * drift (the credentials are fine; only the answer's shape is not).
 */
export function keepsSession(e: unknown): boolean {
  return isTransient(e) || e instanceof ResponseDriftError;
}

export interface ErrorDescription {
  kind: ErrorKind;
  exitCode: number;
  message: string;
  hint?: string;
  retryable: boolean;
}

/** Render any thrown value for a surface, in a language. */
export function describeError(e: unknown, lang: Lang, surface: Surface): ErrorDescription {
  if (e instanceof AgentError) {
    return {
      kind: e.kind,
      exitCode: EXIT_CODE_BY_KIND[e.kind],
      message: MESSAGES[e.key][lang](e.params),
      hint: e.hint ? HINTS[e.hint][lang][surface] : undefined,
      retryable: e.retryable,
    };
  }
  const detail = e instanceof Error ? e.message : String(e);
  return {
    kind: "internal",
    exitCode: EXIT_CODE_BY_KIND.internal,
    message: MESSAGES.internal[lang]({ detail }),
    hint: HINTS.report_bug[lang][surface],
    retryable: false,
  };
}

/** Errors thrown by fetch implementations when the network itself fails. */
const NETWORK_CODES =
  /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|EPIPE|UND_ERR|CERT_|certificate|fetch failed|socket hang up|network/i;

/**
 * Run an HTTP call and turn a transport failure into a NetworkError. Errors
 * that are already AgentErrors, and responses that arrived, pass through.
 */
export async function guardNetwork<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AgentError) throw e;
    const err = e as {
      code?: string;
      name?: string;
      message?: string;
      cause?: { code?: string; message?: string };
    };
    const code = err.cause?.code ?? err.code;
    const text = `${code ?? ""} ${err.name ?? ""} ${err.message ?? ""} ${err.cause?.message ?? ""}`;
    if (NETWORK_CODES.test(text) || err.name === "AbortError" || err.name === "TimeoutError") {
      const detail =
        code ??
        (err.name === "AbortError" || err.name === "TimeoutError"
          ? err.name
          : (err.cause?.message ?? err.message ?? "connection failed"));
      throw new NetworkError(String(detail), e);
    }
    throw e;
  }
}
