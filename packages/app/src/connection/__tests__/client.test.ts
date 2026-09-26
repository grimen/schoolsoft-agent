import { clientFor } from "../client";
import { memoryStorage, newDevConnection, readConnection, saveConnection } from "../store";

function fakeConnector() {
  const calls: string[] = [];
  let refreshes = 0;
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(`${init?.method ?? "GET"} ${url.origin}${url.pathname}`);
    if (url.pathname === "/token") {
      refreshes++;
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
  return { fetch, calls, refreshes: () => refreshes };
}

test("the client uses the page origin and refreshes once for concurrent calls", async () => {
  const storage = memoryStorage();
  const conn = newDevConnection("cid", "r0");
  if ("invalid" in conn) throw new Error("unexpected");
  saveConnection(storage, conn);
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
