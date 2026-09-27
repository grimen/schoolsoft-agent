import { createClient, type ConnectorClient } from "schoolsoft-agent/client";
import type { Language } from "../messages";
import { tokenStoreFor, type DevConnection, type KeyValue } from "./store";

/**
 * Two origins are in play here (Task 8a, ruling R16). `options.origin` ("the page
 * origin") is the address the app itself was served from: in development, the dev
 * proxy (`scripts/dev-proxy.mjs`); later, the connector itself (E11.10). The
 * connector's OAuth `resource` must equal its own public URL + "/mcp" exactly
 * (`src/http/oauth.ts`), which is a *different* address than the proxy in
 * development. Building the typed client against the page origin would send the
 * wrong `resource` on every `/token` refresh and the connector would answer
 * `400 invalid_target`.
 *
 * So `clientFor` first discovers the connector's real resource origin from its
 * RFC 9728 protected-resource metadata, fetched same-origin through the page (the
 * proxy forwards `/.well-known/*` to the connector, and in production the page and
 * the connector share an origin anyway). The typed client is then built with that
 * resource origin as `baseUrl` (so `resource` is right), wrapped in a `fetch` that
 * sends its requests back to the page origin instead — identical to a plain
 * pass-through when the two origins already match.
 */

const WELL_KNOWN_PATH = "/.well-known/oauth-protected-resource/mcp";

/** RFC 9728 discovery of the connector's own resource, same-origin through the page. */
async function discoverResourceOrigin(
  pageOrigin: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  const invalid = () => new Error(`The connector's OAuth metadata at ${pageOrigin} is invalid.`);
  let resource: unknown;
  try {
    const response = await fetchImpl(pageOrigin + WELL_KNOWN_PATH);
    resource = (await (response.json() as Promise<{ resource?: unknown }>))?.resource;
  } catch {
    throw invalid();
  }
  if (typeof resource !== "string") throw invalid();
  try {
    return new URL(resource).origin;
  } catch {
    throw invalid();
  }
}

/**
 * Sends a request bound for `resourceOrigin` to `pageOrigin` instead (same path and
 * query; method, headers and body unchanged); anything else passes through unchanged.
 * When `resourceOrigin === pageOrigin` this is the identity. Exported for direct
 * testing of the pass-through case, which the typed client itself never triggers: it
 * only ever calls `fetch` against its own `baseUrl` (`resourceOrigin`).
 */
export function redirectingFetch(
  resourceOrigin: string,
  pageOrigin: string,
  fetchImpl: typeof fetch,
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    // The typed client only ever calls `fetch` with a plain URL string built from its
    // own `baseUrl`; `String(...)` also accepts a bare `URL` (its `href`) for the type's sake.
    const url = new URL(String(input));
    if (url.origin !== resourceOrigin) return fetchImpl(input, init);
    const target = new URL(pageOrigin);
    target.pathname = url.pathname;
    target.search = url.search;
    return fetchImpl(target.toString(), init);
  }) as typeof fetch;
}

export function clientFor(
  connection: DevConnection,
  storage: KeyValue,
  options: { origin: string; language: Language; fetch?: typeof fetch },
): ConnectorClient {
  const pageOrigin = options.origin;
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);

  // Lazy and memoized: discovery runs once, on the first call, and is shared by any
  // concurrent calls that follow before it settles. A failed discovery clears the
  // memo, so a later call (e.g. the Retry button) tries again.
  let inner: Promise<ConnectorClient> | undefined;
  function connectorClient(): Promise<ConnectorClient> {
    inner ??= discoverResourceOrigin(pageOrigin, fetchImpl)
      .then((resourceOrigin) =>
        createClient({
          baseUrl: resourceOrigin,
          clientId: connection.clientId,
          tokens: tokenStoreFor(storage, connection.clientId),
          language: options.language,
          fetch: redirectingFetch(resourceOrigin, pageOrigin, fetchImpl),
        }),
      )
      .catch((error: unknown) => {
        inner = undefined;
        throw error;
      });
    return inner;
  }

  return {
    session: async () => (await connectorClient()).session(),
    children: async () => (await connectorClient()).children(),
    schedule: async (childId, query) => (await connectorClient()).schedule(childId, query),
    calendar: async (childId, query) => (await connectorClient()).calendar(childId, query),
    lunchMenu: async (childId, query) => (await connectorClient()).lunchMenu(childId, query),
    overview: async (childId, query) => (await connectorClient()).overview(childId, query),
    accessToken: async () => (await connectorClient()).accessToken(),
  };
}
