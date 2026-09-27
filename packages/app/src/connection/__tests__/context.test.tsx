import { act, renderHook } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { ConnectionProvider, useConnection } from "../context";
import { memoryStorage, newDevConnection, readConnection, saveConnection } from "../store";

const conn = () => {
  const c = newDevConnection("cid", "r0");
  if ("invalid" in c) throw new Error("unexpected");
  return c;
};

function wrapperWith(storage = memoryStorage(), persistent = true) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ConnectionProvider
      storage={{ storage, persistent }}
      origin="http://localhost:8080"
      language="sv"
    >
      {children}
    </ConnectionProvider>
  );
  return { storage, wrapper };
}

test("without a stored connection there is no client", async () => {
  const { wrapper } = wrapperWith();
  const { result } = await renderHook(() => useConnection(), { wrapper });
  expect(result.current).toMatchObject({
    connected: false,
    client: undefined,
    persistent: true,
    language: "sv",
  });
});

test("a stored connection gives a client; forget clears it and bumps the generation", async () => {
  const { storage, wrapper } = wrapperWith();
  saveConnection(storage, conn());
  const { result } = await renderHook(() => useConnection(), { wrapper });
  expect(result.current.connected).toBe(true);
  expect(result.current.client).toBeDefined();
  const before = result.current.generation;
  await act(() => result.current.forget());
  expect(result.current.connected).toBe(false);
  expect(readConnection(storage)).toBeUndefined();
  expect(result.current.generation).toBe(before + 1);
});

test("connect stores the connection and bumps the generation", async () => {
  const { storage, wrapper } = wrapperWith(memoryStorage(), false);
  const { result } = await renderHook(() => useConnection(), { wrapper });
  await act(() => result.current.connect(conn()));
  expect(result.current).toMatchObject({ connected: true, persistent: false, generation: 1 });
  expect(readConnection(storage)?.clientId).toBe("cid");
});

test("useConnection outside the provider is a programming error", async () => {
  await expect(renderHook(() => useConnection())).rejects.toThrow("ConnectionProvider");
});

const bareWrapper = ({ children }: { children: ReactNode }) => (
  <ConnectionProvider>{children}</ConnectionProvider>
);

test("the provider's defaults come from the browser and the device", async () => {
  const previousLocation = (globalThis as { location?: unknown }).location;
  const previousSessionStorage = (globalThis as { sessionStorage?: unknown }).sessionStorage;
  (globalThis as { location?: unknown }).location = { origin: "http://localhost" };
  const memory = new Map<string, string>();
  (globalThis as { sessionStorage?: unknown }).sessionStorage = {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
  };
  try {
    const { result } = await renderHook(() => useConnection(), { wrapper: bareWrapper });
    expect(["sv", "en"]).toContain(result.current.language);
    expect(result.current.persistent).toBe(true);
  } finally {
    const g = globalThis as { location?: unknown; sessionStorage?: unknown };
    if (previousLocation === undefined) delete g.location;
    else g.location = previousLocation;
    if (previousSessionStorage === undefined) delete g.sessionStorage;
    else g.sessionStorage = previousSessionStorage;
  }
});
