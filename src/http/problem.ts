/**
 * Every REST failure as `application/problem+json` (RFC 9457): which problem it is,
 * which HTTP status that means, and the core's localized message and hint for the
 * `http` surface. Classification only; the router decides when to send one.
 */
import { z } from "zod";
import { InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import {
  AgentError,
  EXIT_CODE_BY_KIND,
  PortalPushbackError,
  describeError,
  type ErrorKind,
  type Lang,
} from "../core/index.js";
import { ConnectorRefusedError } from "./runtime.js";

/**
 * The problem types, their status and what a UI does about them. The order is the
 * order of the reference table (`make docs`).
 */
export const PROBLEMS = {
  "invalid-input": {
    status: 400,
    title: "Invalid request",
    meaning: "Path or query parameters do not fit the operation's input.",
  },
  "oauth-token": {
    status: 401,
    title: "Access token not accepted",
    meaning:
      "The connection was revoked or expired while the request waited. Refresh the token or connect again; `WWW-Authenticate` is set. A token that is missing, invalid or expired on arrival gets the SDK's own 401 instead.",
  },
  "scope-not-granted": {
    status: 403,
    title: "Operation not granted",
    meaning: "The token's scopes do not include this operation. Nothing was read.",
  },
  "child-not-permitted": {
    status: 403,
    title: "Child not permitted",
    meaning:
      "The child is outside this connection's grant or no longer on the account. Nothing was read.",
  },
  "foreign-origin": {
    status: 403,
    title: "Cross-origin request refused",
    meaning: "The request carried another site's `Origin`; the API is same-origin only.",
  },
  "not-found": {
    status: 404,
    title: "No such route",
    meaning: "Unknown path under `/api/v1`, or a method other than GET.",
  },
  "schoolsoft-session": {
    status: 409,
    title: "SchoolSoft session required",
    meaning:
      "The connector is not signed in to SchoolSoft (never signed in, signed out, or the saved session expired). The token is fine; only the parent can fix this, on the owner dashboard (`ownerDashboard`).",
  },
  "web-session": {
    status: 409,
    title: "SchoolSoft web login required",
    meaning: "The data needs SchoolSoft's separate web login, which the connector does not offer.",
  },
  "rate-limited": {
    status: 429,
    title: "Too many requests",
    meaning: "Per-caller limit reached; `Retry-After` says when to try again.",
  },
  internal: {
    status: 500,
    title: "Connector fault",
    meaning: "A bug in the connector. No detail is returned.",
  },
  "not-implemented": {
    status: 501,
    title: "Not offered",
    meaning: "The school portal or the connector does not offer this capability.",
  },
  "response-drift": {
    status: 502,
    title: "School portal answer changed",
    meaning:
      "The portal answered in a shape that does not map to the domain model; nothing was returned. Retrying does not help.",
  },
  upstream: {
    status: 502,
    title: "School portal error",
    meaning: "The portal answered with an error. Usually temporary.",
  },
  "connector-busy": {
    status: 503,
    title: "Connector busy",
    meaning:
      "Too many requests queued, the connector is shutting down, or the child in focus changed while the request waited. `Retry-After` is set.",
  },
  "portal-pushback": {
    status: 503,
    title: "School portal pushing back",
    meaning:
      "The school portal asked for fewer requests or kept failing, so the connector sends it nothing for a while. `Retry-After` and `retryAt` say when to try again; signing in again does not help.",
  },
  "not-available": {
    status: 503,
    title: "Not available",
    meaning:
      "The connector cannot serve this now (for example its stored state is from a newer version).",
  },
  network: {
    status: 504,
    title: "School portal unreachable",
    meaning: "The connector could not reach the portal (DNS, TCP, TLS or timeout).",
  },
} as const;
export type ProblemName = keyof typeof PROBLEMS;
export const PROBLEM_TYPE_PREFIX = "urn:schoolsoft-agent:problem:";

/** A classified failure: the problem it is and the AgentError whose text describes it. */
export interface Classified {
  name: ProblemName;
  error: AgentError;
}

const WEB_SESSION_KEYS = new Set([
  "web_login_required",
  "web_session_lost",
  "web_session_lost_after",
  "portal_gated",
]);
const NOT_OFFERED_KEYS = new Set([
  "capability_not_supported",
  "browser_required",
  "web_login_unavailable",
]);
const refusal = (key: "connector_child_refused" | "connector_busy" | "connector_child_changed") =>
  new AgentError({
    kind: "input",
    key,
    hint: key === "connector_child_refused" ? "reconnect" : "retry",
    retryable: key !== "connector_child_refused",
  });

/** The problem an error from the runtime, the OAuth provider or the core amounts to. */
export function classify(error: unknown): Classified {
  if (error instanceof InvalidTokenError)
    return {
      name: "oauth-token",
      error: new AgentError({
        kind: "not_authenticated",
        key: "connector_token_invalid",
        hint: "reauthorize",
      }),
    };
  if (error instanceof ConnectorRefusedError)
    return error.reason === "child"
      ? { name: "child-not-permitted", error: refusal("connector_child_refused") }
      : {
          name: "connector-busy",
          error: refusal(
            error.reason === "unavailable" ? "connector_busy" : "connector_child_changed",
          ),
        };
  if (error instanceof PortalPushbackError) return { name: "portal-pushback", error };
  if (!(error instanceof AgentError) || error.kind === "internal")
    return {
      name: "internal",
      error: new AgentError({ kind: "internal", key: "connector_fault", hint: "report_bug" }),
    };
  const byKind: Record<Exclude<ErrorKind, "internal">, ProblemName> = {
    input: "invalid-input",
    not_authenticated: WEB_SESSION_KEYS.has(error.key) ? "web-session" : "schoolsoft-session",
    not_configured: "not-available",
    not_available: NOT_OFFERED_KEYS.has(error.key) ? "not-implemented" : "not-available",
    upstream: error.key === "response_drift" ? "response-drift" : "upstream",
    network: "network",
  };
  const name = byKind[error.kind];
  return { name, error };
}

/** Refusals the router decides itself, before the runtime is involved. */
export const refusals = {
  scope: (operation: string): Classified => ({
    name: "scope-not-granted",
    error: new AgentError({
      kind: "input",
      key: "connector_scope_refused",
      params: { operation },
      hint: "reconnect",
    }),
  }),
  origin: (): Classified => ({
    name: "foreign-origin",
    error: new AgentError({ kind: "input", key: "origin_refused" }),
  }),
  notFound: (): Classified => ({
    name: "not-found",
    error: new AgentError({ kind: "input", key: "route_not_found", hint: "fix_input" }),
  }),
  rateLimited: (): Classified => ({
    name: "rate-limited",
    error: new AgentError({ kind: "input", key: "rate_limited", hint: "retry", retryable: true }),
  }),
};

/** The problem details body (RFC 9457) every REST failure answers, as a schema. */
export const ProblemSchema = z.object({
  type: z.string().describe(`\`${PROBLEM_TYPE_PREFIX}<name>\`; branch on this`),
  title: z.string().describe("Short English title of the problem type"),
  status: z.number().int().describe("The HTTP status this problem is answered with"),
  detail: z.string().describe("What happened, in the negotiated language"),
  hint: z.string().optional().describe("What to do next, in the negotiated language"),
  kind: z
    .enum(Object.keys(EXIT_CODE_BY_KIND) as [ErrorKind, ...ErrorKind[]])
    .describe("The error kind, as the MCP tools and the CLI report it"),
  retryable: z.boolean().describe("Whether repeating the same request may succeed"),
  ownerDashboard: z
    .string()
    .optional()
    .describe("Where the parent signs in to SchoolSoft again (SchoolSoft-session problems)"),
  error: z
    .enum(["invalid_token", "insufficient_scope"])
    .optional()
    .describe("RFC 6750 error code on token problems"),
  retryAt: z
    .string()
    .optional()
    .describe("When the connector sends requests to the school portal again (`portal-pushback`)"),
});
export type ProblemBody = z.infer<typeof ProblemSchema>;

/** The response body for a classified failure, in one language. */
export function problemBody(
  { name, error }: Classified,
  lang: Lang,
  publicUrl: string,
): ProblemBody {
  const described = describeError(error, lang, "http");
  const { status, title } = PROBLEMS[name];
  return {
    type: PROBLEM_TYPE_PREFIX + name,
    title,
    status,
    detail: described.message,
    ...(described.hint ? { hint: described.hint } : {}),
    kind: described.kind,
    retryable: described.retryable,
    ...(name === "schoolsoft-session" || name === "web-session"
      ? { ownerDashboard: publicUrl + "/owner" }
      : {}),
    ...(name === "oauth-token" ? { error: "invalid_token" as const } : {}),
    ...(name === "scope-not-granted" ? { error: "insufficient_scope" as const } : {}),
    ...(error instanceof PortalPushbackError
      ? { retryAt: new Date(error.retryAt).toISOString() }
      : {}),
  };
}

/** Seconds a client should wait before retrying (`Retry-After`), at least 1. */
export function retryAfterSeconds(retryAt: number, now: number): string {
  return String(Math.max(1, Math.ceil((retryAt - now) / 1000)));
}

/**
 * The response language: the first of Swedish or English the caller accepts, by
 * quality; anything else (or nothing) gets the connector's default.
 */
export function negotiateLang(header: string | undefined, fallback: Lang): Lang {
  const ranked = (header ?? "")
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().toLowerCase().split(";");
      const q = params.map((p) => /^\s*q=([0-9.]+)\s*$/.exec(p)?.[1]).find(Boolean);
      return { lang: tag.split("-")[0], q: q === undefined ? 1 : Number(q), index };
    })
    .filter((entry) => (entry.lang === "sv" || entry.lang === "en") && entry.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  // A constant, never the header's own text: only "sv" or "en" can leave here.
  const first = ranked[0]?.lang;
  return first === "sv" ? "sv" : first === "en" ? "en" : fallback;
}
