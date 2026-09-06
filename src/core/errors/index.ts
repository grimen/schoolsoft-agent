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

/** Bad arguments from the caller (agent or human). */
export class InputError extends AgentError {
  constructor(detail: string) {
    super({ kind: "input", key: "input", params: { detail }, hint: "fix_input" });
  }
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
