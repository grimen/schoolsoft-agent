import {
  STORAGE_KEY,
  forgetConnection,
  memoryStorage,
  newDevConnection,
  openStorage,
  readConnection,
  saveConnection,
  tokenStoreFor,
} from "../store";

test("a new development connection starts with an expired access token", () => {
  expect(newDevConnection(" cid ", " rt ")).toEqual({
    clientId: "cid",
    tokens: { accessToken: "", refreshToken: "rt", expiresAt: 0 },
  });
});

test("invalid input names the field", () => {
  expect(newDevConnection("", "rt")).toEqual({ invalid: "clientId" });
  expect(newDevConnection("c id", "rt")).toEqual({ invalid: "clientId" });
  expect(newDevConnection("cid", "  ")).toEqual({ invalid: "refreshToken" });
});

test("save, read and forget round-trip under the app's own key", () => {
  const s = memoryStorage();
  const c = newDevConnection("cid", "rt");
  if ("invalid" in c) throw new Error("unexpected");
  saveConnection(s, c);
  expect(s.getItem(STORAGE_KEY)).not.toBeNull();
  expect(readConnection(s)).toEqual(c);
  forgetConnection(s);
  expect(readConnection(s)).toBeUndefined();
});

test("a corrupt or wrong-shaped entry reads as no connection", () => {
  const s = memoryStorage();
  for (const raw of [
    "{not json",
    JSON.stringify("text"),
    JSON.stringify({ clientId: 5, tokens: { accessToken: "", refreshToken: "r" } }),
    JSON.stringify({ clientId: "", tokens: { accessToken: "", refreshToken: "r" } }),
    JSON.stringify({ clientId: "cid", tokens: null }),
    JSON.stringify({ clientId: "cid", tokens: { accessToken: 1, refreshToken: "r" } }),
    JSON.stringify({ clientId: "cid", tokens: { accessToken: "", refreshToken: 2 } }),
  ]) {
    s.setItem(STORAGE_KEY, raw);
    expect(readConnection(s)).toBeUndefined();
  }
});

test("a connection without a known expiry reads back without one", () => {
  const s = memoryStorage();
  s.setItem(
    STORAGE_KEY,
    JSON.stringify({ clientId: "cid", tokens: { accessToken: "a", refreshToken: "r" } }),
  );
  expect(readConnection(s)).toEqual({
    clientId: "cid",
    tokens: { accessToken: "a", refreshToken: "r" },
  });
});

test("the token store saves rotated tokens and clears the whole connection", async () => {
  const s = memoryStorage();
  const store = tokenStoreFor(s, "cid");
  expect(await store.load()).toBeUndefined();
  await store.save({ accessToken: "a", refreshToken: "r2", expiresAt: 5 });
  expect(readConnection(s)).toEqual({
    clientId: "cid",
    tokens: { accessToken: "a", refreshToken: "r2", expiresAt: 5 },
  });
  expect(await store.load()).toEqual({ accessToken: "a", refreshToken: "r2", expiresAt: 5 });
  await store.clear();
  expect(readConnection(s)).toBeUndefined();
});

test("openStorage uses the candidate when it works", () => {
  const working = memoryStorage();
  expect(openStorage(() => working)).toEqual({ storage: working, persistent: true });
});

test("openStorage falls back to memory when storage throws or is missing", () => {
  const throwing = openStorage(() => {
    throw new Error("SecurityError");
  });
  expect(throwing.persistent).toBe(false);
  throwing.storage.setItem("k", "v");
  expect(throwing.storage.getItem("k")).toBe("v");
  const missing = openStorage(() => undefined as never);
  expect(missing.persistent).toBe(false);
});

test("openStorage defaults to the browser's sessionStorage", () => {
  const memory = new Map<string, string>();
  const stub: Storage = {
    length: 0,
    clear: () => memory.clear(),
    key: () => null,
    getItem: (k) => memory.get(k) ?? null,
    setItem: (k, v) => void memory.set(k, v),
    removeItem: (k) => void memory.delete(k),
  };
  const original = (globalThis as { sessionStorage?: Storage }).sessionStorage;
  (globalThis as { sessionStorage?: Storage }).sessionStorage = stub;
  try {
    expect(openStorage().persistent).toBe(true);
  } finally {
    (globalThis as { sessionStorage?: Storage }).sessionStorage = original;
  }
});

test("openStorage falls back to memory when there is no global sessionStorage", () => {
  const original = (globalThis as { sessionStorage?: Storage }).sessionStorage;
  delete (globalThis as { sessionStorage?: Storage }).sessionStorage;
  try {
    const result = openStorage();
    expect(result.persistent).toBe(false);
    result.storage.setItem("k", "v");
    expect(result.storage.getItem("k")).toBe("v");
  } finally {
    (globalThis as { sessionStorage?: Storage }).sessionStorage = original;
  }
});
