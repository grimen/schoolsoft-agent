import type { Tokens, TokenStore } from "schoolsoft-agent/client";

/** The app's own key; the reference page's `schoolsoft-reference` is never written. */
export const STORAGE_KEY = "schoolsoft-app-dev";

export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface DevConnection {
  clientId: string;
  tokens: Tokens;
}

export function memoryStorage(): KeyValue {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

/** sessionStorage while the tab lives; memory when the browser blocks or lacks storage. */
export function openStorage(
  candidate: () => KeyValue = () => globalThis.sessionStorage as unknown as KeyValue,
): { storage: KeyValue; persistent: boolean } {
  try {
    const storage = candidate();
    storage.getItem(STORAGE_KEY);
    return { storage, persistent: true };
  } catch {
    return { storage: memoryStorage(), persistent: false };
  }
}

const isText = (v: unknown): v is string => typeof v === "string";

export function readConnection(storage: KeyValue): DevConnection | undefined {
  try {
    const raw = JSON.parse(storage.getItem(STORAGE_KEY) ?? "null") as unknown;
    if (typeof raw !== "object" || raw === null) return undefined;
    const { clientId, tokens } = raw as { clientId?: unknown; tokens?: Record<string, unknown> };
    if (!isText(clientId) || clientId === "" || typeof tokens !== "object" || tokens === null)
      return undefined;
    if (!isText(tokens.accessToken) || !isText(tokens.refreshToken)) return undefined;
    return {
      clientId,
      tokens: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        ...(typeof tokens.expiresAt === "number" ? { expiresAt: tokens.expiresAt } : {}),
      },
    };
  } catch {
    return undefined;
  }
}

export function saveConnection(storage: KeyValue, connection: DevConnection): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(connection));
}

export function forgetConnection(storage: KeyValue): void {
  storage.removeItem(STORAGE_KEY);
}

/** An expired, empty access token makes the typed client refresh before the first request. */
export function newDevConnection(
  clientId: string,
  refreshToken: string,
): DevConnection | { invalid: "clientId" | "refreshToken" } {
  const id = clientId.trim();
  const refresh = refreshToken.trim();
  if (id === "" || /\s/.test(id)) return { invalid: "clientId" };
  if (refresh === "") return { invalid: "refreshToken" };
  return { clientId: id, tokens: { accessToken: "", refreshToken: refresh, expiresAt: 0 } };
}

export function tokenStoreFor(storage: KeyValue, clientId: string): TokenStore {
  return {
    load: () => readConnection(storage)?.tokens,
    save: (tokens) => saveConnection(storage, { clientId, tokens }),
    clear: () => forgetConnection(storage),
  };
}
