import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { ConnectionProvider } from "../../src/connection/context";
import { memoryStorage, newDevConnection, saveConnection } from "../../src/connection/store";
import Index from "../index";

// React Native renders strings only inside <Text>, so the mock returns one.
jest.mock("expo-router", () => {
  const { Text } = jest.requireActual<typeof import("react-native")>("react-native");
  return { Redirect: ({ href }: { href: string }) => <Text>{`redirect:${href}`}</Text> };
});

function withConnection(fetch: typeof globalThis.fetch, connected = true) {
  const storage = memoryStorage();
  const c = newDevConnection("cid", "r0");
  if (connected && !("invalid" in c)) saveConnection(storage, c);
  return ({ children }: { children: ReactNode }) => (
    <ConnectionProvider
      storage={{ storage, persistent: true }}
      origin="http://localhost:8080"
      language="en"
      fetch={fetch}
    >
      {children}
    </ConnectionProvider>
  );
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const token = json({
  access_token: "a",
  refresh_token: "r1",
  token_type: "Bearer",
  expires_in: 300,
});
// Same-origin (production-like): the page origin is the connector's own resource origin.
const discovery = json({ resource: "http://localhost:8080/mcp" });
const WELL_KNOWN = "/.well-known/oauth-protected-resource/mcp";
// A schema-valid `Session`: the typed client validates every answer against it.
const session = (children: Array<{ id: number; firstName: string }>, signedIn = true) =>
  json({
    schoolsoft: {
      signedIn,
      loginInProgress: false,
      webSession: false,
      portal: { state: "ok", retryAt: null },
    },
    children,
    scopes: ["get_schedule", "get_lunch_menu", "get_calendar"],
    routes: [],
    ownerDashboard: "https://localhost:8080/dashboard",
    connectionExpiresAt: "2026-12-31T00:00:00Z",
  });

test("lists the children's first names", async () => {
  const fetch = (async (u: RequestInfo | URL) =>
    String(u).endsWith(WELL_KNOWN)
      ? discovery.clone()
      : String(u).endsWith("/token")
        ? token.clone()
        : session([
            { id: 1, firstName: "Synthetic Alva" },
            { id: 2, firstName: "Synthetic Bo" },
          ])) as typeof globalThis.fetch;
  await render(<Index />, { wrapper: withConnection(fetch) });
  await waitFor(() => expect(screen.getByText("Synthetic Alva")).toBeTruthy());
  expect(screen.getByText("Synthetic Bo")).toBeTruthy();
});

test("an empty grant says so", async () => {
  const fetch = (async (u: RequestInfo | URL) =>
    String(u).endsWith(WELL_KNOWN)
      ? discovery.clone()
      : String(u).endsWith("/token")
        ? token.clone()
        : session([])) as typeof globalThis.fetch;
  await render(<Index />, { wrapper: withConnection(fetch) });
  await waitFor(() => expect(screen.getByText(/covers no children/)).toBeTruthy());
});

test("a signed-out session links the connector's own dashboard", async () => {
  const fetch = (async (u: RequestInfo | URL) =>
    String(u).endsWith(WELL_KNOWN)
      ? discovery.clone()
      : String(u).endsWith("/token")
        ? token.clone()
        : session([], false)) as typeof globalThis.fetch;
  await render(<Index />, { wrapper: withConnection(fetch) });
  await waitFor(() =>
    expect(screen.getByText("The connector needs a new SchoolSoft sign-in.")).toBeTruthy(),
  );
  expect(screen.getByText("https://localhost:8080/dashboard")).toBeTruthy();
});

test("a spent refresh token asks to connect again and offers to forget", async () => {
  const fetch = (async (u: RequestInfo | URL) =>
    String(u).endsWith(WELL_KNOWN)
      ? discovery.clone()
      : json({ error: "invalid_grant" }, 400)) as typeof globalThis.fetch;
  await render(<Index />, { wrapper: withConnection(fetch) });
  await waitFor(() => expect(screen.getByText("The connection has ended.")).toBeTruthy());
  await fireEvent.press(screen.getByText("Forget this connection"));
  await waitFor(() => expect(screen.getByText("redirect:/dev-connect")).toBeTruthy());
});

test("without a connection a development build goes to dev-connect", async () => {
  const fetch = (async () => json({})) as typeof globalThis.fetch;
  await render(<Index />, { wrapper: withConnection(fetch, false) });
  expect(screen.getByText("redirect:/dev-connect")).toBeTruthy();
});
