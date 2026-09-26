import { createClient, type ConnectorClient } from "schoolsoft-agent/client";
import type { Language } from "../messages";
import { tokenStoreFor, type DevConnection, type KeyValue } from "./store";

/** The page's own origin: in development the proxy, later the connector itself (E11.10). */
export function clientFor(
  connection: DevConnection,
  storage: KeyValue,
  options: { origin: string; language: Language; fetch?: typeof fetch },
): ConnectorClient {
  return createClient({
    baseUrl: options.origin,
    clientId: connection.clientId,
    tokens: tokenStoreFor(storage, connection.clientId),
    language: options.language,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
}
