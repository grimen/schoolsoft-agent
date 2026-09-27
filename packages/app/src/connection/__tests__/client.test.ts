import { clientFor, redirectingFetch } from "../client";
import { memoryStorage, newDevConnection, readConnection, saveConnection } from "../store";

/**
 * A fake connector reachable only at `origin`. It answers RFC 9728 discovery with
 * `resource` (default: `origin + "/mcp"`, the same-origin/production-like case),
 * `/token` refreshes, and any other path with a synthetic children list.
 */
function fakeConnector(origin = "http://localhost:8080", resource = origin + "/mcp") {
  const calls: string[] = [];
  let refreshes = 0;
  let discoveries = 0;
  let lastRefreshResource: string | undefined;
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(`${init?.method ?? "GET"} ${url.origin}${url.pathname}`);
    if (url.pathname === "/.well-known/oauth-protected-resource/mcp") {
      discoveries++;
      return new Response(JSON.stringify({ resource }), {
        headers: { "content-type": "application/json" },
      });
    }
    if (url.pathname === "/token") {
      refreshes++;
      lastRefreshResource = new URLSearchParams(String(init?.body)).get("resource") ?? undefined;
      await new Promise((r) => setTimeout(r, 5));
      return new Response(
        JSON.stringify({
          access_token: `a${refreshes}`,
          refresh_token: `r${refreshes}`,
          token_type: "Bearer",
          expires_in: 300,
        }),
        {
          headers: { "content-type": "application/json" },
        },
      );
    }
    return new Response(
      JSON.stringify({ children: [{ id: 201, firstName: "Synthetic Alva" }], childInFocus: null }),
      {
        headers: { "content-type": "application/json" },
      },
    );
  }) as typeof globalThis.fetch;
  return {
    fetch,
    calls,
    refreshes: () => refreshes,
    discoveries: () => discoveries,
    lastRefreshResource: () => lastRefreshResource,
  };
}

function connected(storage = memoryStorage()) {
  const conn = newDevConnection("cid", "r0");
  if ("invalid" in conn) throw new Error("unexpected");
  saveConnection(storage, conn);
  return { storage, conn };
}

test("the client uses the page origin and refreshes once for concurrent calls", async () => {
  const { storage, conn } = connected();
  const connector = fakeConnector();
  const client = clientFor(conn, storage, {
    origin: "http://localhost:8080",
    language: "en",
    fetch: connector.fetch,
  });
  const answers = await Promise.all([client.children(), client.children(), client.children()]);
  expect(answers.map((a) => a.children[0]!.firstName)).toEqual([
    "Synthetic Alva",
    "Synthetic Alva",
    "Synthetic Alva",
  ]);
  expect(connector.refreshes()).toBe(1);
  expect(connector.calls.every((c) => c.includes("http://localhost:8080/"))).toBe(true);
  expect(readConnection(storage)?.tokens.refreshToken).toBe("r1");
});

test("discovers the connector's resource when it differs from the page origin", async () => {
  const { storage, conn } = connected();
  const pageOrigin = "http://127.0.0.1:8080";
  const connector = fakeConnector(pageOrigin, "http://localhost:3000/mcp");
  const client = clientFor(conn, storage, {
    origin: pageOrigin,
    language: "en",
    fetch: connector.fetch,
  });
  const answers = await Promise.all([client.children(), client.children(), client.children()]);
  expect(answers.map((a) => a.children[0]!.firstName)).toEqual([
    "Synthetic Alva",
    "Synthetic Alva",
    "Synthetic Alva",
  ]);
  expect(connector.discoveries()).toBe(1);
  expect(connector.refreshes()).toBe(1);
  expect(connector.calls.every((c) => c.includes(pageOrigin + "/"))).toBe(true);
  expect(connector.lastRefreshResource()).toBe("http://localhost:3000/mcp");
});

test("same-origin (production-like): the resource matches the page and nothing is rewritten", async () => {
  const { storage, conn } = connected();
  const origin = "https://connector.example";
  const connector = fakeConnector(origin);
  const client = clientFor(conn, storage, { origin, language: "en", fetch: connector.fetch });
  const answer = await client.children();
  expect(answer.children[0]!.firstName).toBe("Synthetic Alva");
  expect(connector.discoveries()).toBe(1);
  expect(connector.lastRefreshResource()).toBe("https://connector.example/mcp");
  expect(connector.calls.every((c) => c.includes(origin + "/"))).toBe(true);
});

test("metadata that isn't JSON makes children() reject naming the page origin, and a later call retries discovery", async () => {
  const { storage, conn } = connected();
  const pageOrigin = "http://127.0.0.1:8080";
  let attempts = 0;
  const fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    expect(url.pathname).toBe("/.well-known/oauth-protected-resource/mcp");
    attempts++;
    return new Response("not json", { headers: { "content-type": "text/plain" } });
  }) as typeof globalThis.fetch;
  const client = clientFor(conn, storage, { origin: pageOrigin, language: "en", fetch });
  await expect(client.children()).rejects.toThrow(pageOrigin);
  expect(attempts).toBe(1);
  await expect(client.children()).rejects.toThrow(pageOrigin);
  expect(attempts).toBe(2);
});

test("metadata with no resource field makes children() reject naming the page origin", async () => {
  const { storage, conn } = connected();
  const pageOrigin = "http://127.0.0.1:8080";
  const fetch = (async () =>
    new Response(JSON.stringify({}), {
      headers: { "content-type": "application/json" },
    })) as typeof globalThis.fetch;
  const client = clientFor(conn, storage, { origin: pageOrigin, language: "en", fetch });
  await expect(client.children()).rejects.toThrow(pageOrigin);
});

test("metadata whose resource is not a valid absolute URL makes children() reject naming the page origin", async () => {
  const { storage, conn } = connected();
  const pageOrigin = "http://127.0.0.1:8080";
  const fetch = (async () =>
    new Response(JSON.stringify({ resource: "not a url" }), {
      headers: { "content-type": "application/json" },
    })) as typeof globalThis.fetch;
  const client = clientFor(conn, storage, { origin: pageOrigin, language: "en", fetch });
  await expect(client.children()).rejects.toThrow(pageOrigin);
});

test("redirectingFetch passes a request for another origin through unchanged", async () => {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response("ok");
  }) as typeof globalThis.fetch;
  const wrapped = redirectingFetch("http://localhost:3000", "http://127.0.0.1:8080", fetchImpl);
  const response = await wrapped("https://elsewhere.example/path?x=1", { method: "POST" });
  expect(await response.text()).toBe("ok");
  expect(calls).toEqual(["https://elsewhere.example/path?x=1"]);
});

test("delegates every other method to the discovered client", async () => {
  const { storage, conn } = connected();
  const connector = fakeConnector();
  const client = clientFor(conn, storage, {
    origin: "http://localhost:8080",
    language: "en",
    fetch: connector.fetch,
  });
  await expect(client.accessToken()).resolves.toEqual(expect.any(String));
  await Promise.allSettled([
    client.session(),
    client.schedule(1),
    client.calendar(1),
    client.lunchMenu(1),
    client.overview(1),
  ]);
  expect(connector.calls.some((c) => c.endsWith("/session"))).toBe(true);
  expect(connector.calls.some((c) => c.endsWith("/schedule"))).toBe(true);
  expect(connector.calls.some((c) => c.endsWith("/calendar"))).toBe(true);
  expect(connector.calls.some((c) => c.endsWith("/lunch-menu"))).toBe(true);
  expect(connector.calls.some((c) => c.endsWith("/overview"))).toBe(true);
});
