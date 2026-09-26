/**
 * A typed client for a schoolsoft-agent connector's REST API (`/api/v1`), for custom UIs
 * such as the E11 app. Imports nothing but Zod and its own generated half
 * (`api.gen.ts`, written by `make docs` from the connector's own schemas), so a bundler
 * pulls in no connector code. It calls every route, validates every answer, owns the
 * token refresh (one at a time: refresh tokens rotate, and presenting one twice
 * revokes the whole connection) and turns every failure into a `ConnectorError` with
 * the error kinds the MCP tools and the CLI use. Signing in (registration, PKCE, the
 * redirect) is the app's; the client starts from the tokens it got.
 */
import { z } from "zod";
import {
  API_BASE,
  RESOURCE_PATH,
  ROUTES,
  SCHEMAS,
  type ErrorKind,
  type Operations,
  type Problem,
  type ProblemName,
  type SchemaName,
} from "./api.gen.js";

export * from "./api.gen.js";

/** What the client keeps between calls. `expiresAt` is epoch milliseconds, when known. */
export interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresAt?: number;
}

/**
 * Where the app keeps its tokens (memory, secure storage). The client loads them once,
 * then saves every rotation before it uses the new access token, and clears them when
 * the connection is gone.
 */
export interface TokenStore {
  load(): Tokens | undefined | Promise<Tokens | undefined>;
  save(tokens: Tokens): void | Promise<void>;
  clear(): void | Promise<void>;
}

/** A store that lives as long as the page or process. */
export function memoryTokenStore(initial?: Tokens): TokenStore & { current(): Tokens | undefined } {
  let tokens = initial;
  return {
    load: () => tokens,
    save: (next) => {
      tokens = next;
    },
    clear: () => {
      tokens = undefined;
    },
    current: () => tokens,
  };
}

export interface ClientOptions {
  /** The connector's origin, e.g. `https://connector.example` (no path). */
  baseUrl: string;
  /** The client id from the connector's dynamic registration (a public client). */
  clientId: string;
  tokens: TokenStore;
  /** `fetch` to use; default the global one. */
  fetch?: typeof globalThis.fetch;
  /** Language of problem `detail` and `hint`; default the connector's. */
  language?: "sv" | "en";
  /** Clock for token expiry (tests). */
  now?: () => number;
}

/** Refresh this long before a known expiry, so a token does not expire in flight. */
export const EXPIRY_MARGIN_MS = 30_000;

/**
 * Every failure the client reports. `kind` and `retryable` mean what they mean for the
 * MCP tools and the CLI; `problem` is the connector's problem type name, when it sent one.
 */
export class ConnectorError extends Error {
  readonly kind: ErrorKind;
  readonly retryable: boolean;
  /** The HTTP status, or null when no answer arrived. */
  readonly status: number | null;
  readonly problem: ProblemName | null;
  readonly hint?: string;
  /** Where the parent signs in to SchoolSoft again (`schoolsoft-session`, `web-session`). */
  readonly ownerDashboard?: string;
  /** When the connector sends requests to the school portal again (`portal-pushback`). */
  readonly retryAt?: string;
  /** The problem details body, when the connector answered with one. */
  readonly body?: Problem;

  constructor(init: {
    kind: ErrorKind;
    retryable: boolean;
    status: number | null;
    problem: ProblemName | null;
    message: string;
    body?: Problem;
    cause?: unknown;
  }) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = "ConnectorError";
    this.kind = init.kind;
    this.retryable = init.retryable;
    this.status = init.status;
    this.problem = init.problem;
    this.body = init.body;
    this.hint = init.body?.hint;
    this.ownerDashboard = init.body?.ownerDashboard;
    this.retryAt = init.body?.retryAt;
  }
}

const PROBLEM_PREFIX = "urn:schoolsoft-agent:problem:";

const disconnected = (message: string, status: number | null = null, cause?: unknown) =>
  new ConnectorError({
    kind: "not_authenticated",
    retryable: false,
    status,
    problem: "oauth-token",
    message,
    cause,
  });

const validators = new Map<SchemaName, z.ZodType>();
/** The answer's schema as a Zod validator, built once from the generated JSON Schema. */
function validator(name: SchemaName): z.ZodType {
  let schema = validators.get(name);
  if (!schema) {
    schema = z.fromJSONSchema(SCHEMAS[name] as Parameters<typeof z.fromJSONSchema>[0]);
    validators.set(name, schema);
  }
  return schema;
}

/** Validate an answer against a named schema; a misfit is `response-drift`. */
export function validate<T>(name: SchemaName, value: unknown, status = 200): T {
  const parsed = validator(name).safeParse(value);
  if (parsed.success) return parsed.data as T;
  throw new ConnectorError({
    kind: "upstream",
    retryable: false,
    status,
    problem: "response-drift",
    message: `The connector's answer does not fit the ${name} schema: ${parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"} ${issue.code}`)
      .join(", ")}`,
  });
}

type Query = Record<string, string | number | boolean | undefined>;

/** The body as JSON; a body that is not JSON is undefined, which no schema accepts. */
const json = (response: Response): Promise<unknown> => response.json().catch(() => undefined);

export interface ConnectorClient {
  session(): Promise<Operations["getSession"]["response"]>;
  children(): Promise<Operations["listChildren"]["response"]>;
  schedule(
    childId: number,
    query?: Operations["getSchedule"]["query"],
  ): Promise<Operations["getSchedule"]["response"]>;
  calendar(
    childId: number,
    query?: Operations["getCalendar"]["query"],
  ): Promise<Operations["getCalendar"]["response"]>;
  lunchMenu(
    childId: number,
    query?: Operations["getLunchMenu"]["query"],
  ): Promise<Operations["getLunchMenu"]["response"]>;
  overview(
    childId: number,
    query?: Operations["getOverview"]["query"],
  ): Promise<Operations["getOverview"]["response"]>;
  /** The current access token, refreshed first when it is known to be expired. */
  accessToken(): Promise<string>;
}

export function createClient(options: ClientOptions): ConnectorClient {
  // The origin alone: a path, query or trailing slash in baseUrl is ignored.
  const origin = new URL(options.baseUrl).origin;
  const send = options.fetch ?? globalThis.fetch.bind(globalThis);
  const now = options.now ?? Date.now;
  let tokens: Tokens | undefined;
  let loaded: Promise<void> | undefined;
  let refreshing: Promise<Tokens> | undefined;

  const load = () =>
    (loaded ??= Promise.resolve(options.tokens.load()).then((stored) => {
      tokens = stored;
    }));

  const request = async (url: string, init: RequestInit): Promise<Response> => {
    try {
      return await send(url, init);
    } catch (cause) {
      throw new ConnectorError({
        kind: "network",
        retryable: true,
        status: null,
        problem: null,
        message: "The connector could not be reached.",
        cause,
      });
    }
  };

  /** One refresh request; the new pair is saved before anyone uses it. */
  const refresh = async (current: Tokens): Promise<Tokens> => {
    const response = await request(origin + "/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: current.refreshToken,
        client_id: options.clientId,
        resource: origin + RESOURCE_PATH,
      }).toString(),
    });
    const body = (await response.json().catch(() => ({}))) as {
      access_token?: unknown;
      refresh_token?: unknown;
      expires_in?: unknown;
    };
    if (
      !response.ok ||
      typeof body.access_token !== "string" ||
      typeof body.refresh_token !== "string"
    ) {
      tokens = undefined;
      await options.tokens.clear();
      throw disconnected(
        "The connection was revoked or has expired; connect the app again.",
        response.status,
      );
    }
    const next: Tokens = {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      ...(typeof body.expires_in === "number" ? { expiresAt: now() + body.expires_in * 1000 } : {}),
    };
    // In memory first: the old refresh token is spent, so it must never be sent again,
    // even if saving fails. The new access token is used only once the save resolved.
    tokens = next;
    await options.tokens.save(next);
    return next;
  };

  /**
   * A token newer than `used`. Decided synchronously against the pair in memory: if
   * another call already rotated `used`, take the new one; if a refresh is running,
   * wait for it; otherwise start the only one.
   */
  const renewed = (used: string): Promise<string> => {
    if (!tokens) return Promise.reject(disconnected("Not connected: no tokens."));
    if (tokens.accessToken !== used) return Promise.resolve(tokens.accessToken);
    refreshing ??= refresh(tokens).finally(() => {
      refreshing = undefined;
    });
    return refreshing.then((next) => next.accessToken);
  };

  const accessToken = async (): Promise<string> => {
    await load();
    if (refreshing) return (await refreshing).accessToken;
    if (!tokens) throw disconnected("Not connected: no tokens.");
    const current = tokens.accessToken;
    if (tokens.expiresAt !== undefined && now() >= tokens.expiresAt - EXPIRY_MARGIN_MS)
      return renewed(current);
    return current;
  };

  const failure = async (response: Response): Promise<ConnectorError> => {
    const type = response.headers.get("content-type") ?? "";
    if (type.startsWith("application/problem+json")) {
      const body = validate<Problem>("Problem", await json(response), response.status);
      const name = body.type.startsWith(PROBLEM_PREFIX)
        ? (body.type.slice(PROBLEM_PREFIX.length) as ProblemName)
        : null;
      return new ConnectorError({
        kind: body.kind,
        retryable: body.retryable,
        status: response.status,
        problem: name,
        message: body.detail,
        body,
      });
    }
    return new ConnectorError({
      kind: "upstream",
      retryable: response.status >= 500,
      status: response.status,
      problem: null,
      message: `The connector answered ${response.status} without problem details.`,
    });
  };

  async function call<K extends keyof Operations>(
    id: K,
    childId: number | undefined,
    query: Query = {},
  ): Promise<Operations[K]["response"]> {
    const route = ROUTES[id];
    const path = route.path.replace("{childId}", encodeURIComponent(String(childId)));
    const search = new URLSearchParams();
    for (const name of route.query) {
      const value = query[name];
      if (value !== undefined) search.set(name, String(value));
    }
    const url = origin + API_BASE + path + (search.size ? "?" + search.toString() : "");
    const attempt = (token: string) =>
      request(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(options.language ? { "Accept-Language": options.language } : {}),
        },
      });
    const token = await accessToken();
    let response = await attempt(token);
    if (response.status === 401) {
      // Once: the retry either works with the renewed token or the connection is gone.
      response = await attempt(await renewed(token));
      if (response.status === 401) {
        const refused = await failure(response);
        tokens = undefined;
        await options.tokens.clear();
        throw disconnected(
          "The connection was revoked or has expired; connect the app again.",
          401,
          refused,
        );
      }
    }
    if (!response.ok) throw await failure(response);
    return validate<Operations[K]["response"]>(route.schema, await json(response), response.status);
  }

  return {
    session: () => call("getSession", undefined),
    children: () => call("listChildren", undefined),
    schedule: (childId, query) => call("getSchedule", childId, query),
    calendar: (childId, query) => call("getCalendar", childId, query),
    lunchMenu: (childId, query) => call("getLunchMenu", childId, query),
    overview: (childId, query) => call("getOverview", childId, query),
    accessToken,
  };
}
