import { act, renderHook, waitFor } from "@testing-library/react-native";
import { ConnectorError, type ConnectorClient } from "schoolsoft-agent/client";
import { useChildren } from "../use-children";

function fakeClient(answers: Array<() => Promise<unknown>>): ConnectorClient {
  let i = 0;
  return {
    session: () => answers[Math.min(i++, answers.length - 1)]!(),
  } as unknown as ConnectorClient;
}
const okSchoolsoft = {
  signedIn: true,
  loginInProgress: false,
  webSession: false,
  portal: { state: "ok" as const, retryAt: null },
};
// A macrotask delay: `act()` drains pending microtasks eagerly, so an answer that
// resolves on the microtask queue lands before an awaited render/rerender returns,
// making the transitional "loading" state unobservable. A `setTimeout` keeps it real.
const session = (children: Array<{ id: number; firstName: string }>) => () =>
  new Promise<unknown>((resolve) =>
    setTimeout(
      () =>
        resolve({
          schoolsoft: okSchoolsoft,
          children,
          scopes: ["get_schedule", "get_lunch_menu", "get_calendar"],
          routes: [],
          ownerDashboard: "https://connector.example/dashboard",
          connectionExpiresAt: "2026-12-31T00:00:00Z",
        }),
      5,
    ),
  );
const list = (names: string[]) => session(names.map((firstName, id) => ({ id, firstName })));

test("without a client the state stays loading", async () => {
  const { result } = await renderHook(() => useChildren(undefined, 0));
  expect(result.current.state).toEqual({ status: "loading" });
});

test("loading, then the list", async () => {
  const client = fakeClient([list(["Alva", "Bo"])]);
  const { result } = await renderHook(() => useChildren(client, 0));
  expect(result.current.state.status).toBe("loading");
  await waitFor(() => expect(result.current.state.status).toBe("list"));
  expect(result.current.state).toMatchObject({
    children: [{ firstName: "Alva" }, { firstName: "Bo" }],
  });
});

test("an empty grant is empty, not an empty list", async () => {
  const client = fakeClient([list([])]);
  const { result } = await renderHook(() => useChildren(client, 0));
  await waitFor(() => expect(result.current.state).toEqual({ status: "empty" }));
});

test("a failure is an error state, and reload tries again", async () => {
  const boom = new Error("boom");
  const client = fakeClient([() => Promise.reject(boom), list(["Alva"])]);
  const { result } = await renderHook(() => useChildren(client, 0));
  await waitFor(() => expect(result.current.state).toEqual({ status: "error", error: boom }));
  await act(() => result.current.reload());
  await waitFor(() => expect(result.current.state.status).toBe("list"));
});

test("a late answer from an earlier connection is dropped", async () => {
  let release!: () => void;
  const slow = () =>
    new Promise<unknown>(
      (r) =>
        (release = () =>
          r({
            schoolsoft: okSchoolsoft,
            children: [{ id: 1, firstName: "Old" }],
            scopes: [],
            routes: [],
            ownerDashboard: "https://connector.example/dashboard",
            connectionExpiresAt: "2026-12-31T00:00:00Z",
          })),
    );
  const { result, rerender } = await renderHook(
    ({ c, g }: { c: ConnectorClient; g: number }) => useChildren(c, g),
    {
      initialProps: { c: fakeClient([slow]), g: 0 },
    },
  );
  await rerender({ c: fakeClient([list(["New"])]), g: 1 });
  await waitFor(() =>
    expect(result.current.state).toMatchObject({ children: [{ firstName: "New" }] }),
  );
  await act(async () => release());
  expect(result.current.state).toMatchObject({ children: [{ firstName: "New" }] });
});

test("disconnecting clears a previous connection's children, not just adds a new one", async () => {
  const client = fakeClient([list(["Alva"])]);
  const { result, rerender } = await renderHook(
    ({ c, g }: { c: ConnectorClient | undefined; g: number }) => useChildren(c, g),
    { initialProps: { c: client, g: 0 } },
  );
  await waitFor(() =>
    expect(result.current.state).toMatchObject({ children: [{ firstName: "Alva" }] }),
  );
  await rerender({ c: undefined, g: 1 });
  expect(result.current.state).toEqual({ status: "loading" });
});

test("a late failure from an earlier connection is dropped too", async () => {
  let fail!: () => void;
  const slow = () => new Promise<unknown>((_r, reject) => (fail = () => reject(new Error("old"))));
  const { result, rerender } = await renderHook(
    ({ c, g }: { c: ConnectorClient; g: number }) => useChildren(c, g),
    {
      initialProps: { c: fakeClient([slow]), g: 0 },
    },
  );
  await rerender({ c: fakeClient([list(["New"])]), g: 1 });
  await waitFor(() =>
    expect(result.current.state).toMatchObject({ children: [{ firstName: "New" }] }),
  );
  await act(async () => fail());
  expect(result.current.state).toMatchObject({ children: [{ firstName: "New" }] });
});

test("a signed-out session is an error, not an authenticated empty grant", async () => {
  const client = fakeClient([
    () =>
      Promise.resolve({
        schoolsoft: { ...okSchoolsoft, signedIn: false },
        children: [],
        scopes: [],
        routes: [],
        ownerDashboard: "https://connector.example/dashboard",
        connectionExpiresAt: "2026-12-31T00:00:00Z",
      }),
  ]);
  const { result } = await renderHook(() => useChildren(client, 0));
  await waitFor(() => expect(result.current.state.status).toBe("error"));
  const { error } = result.current.state as { status: "error"; error: unknown };
  expect(error).toBeInstanceOf(ConnectorError);
  expect((error as ConnectorError).problem).toBe("schoolsoft-session");
  expect((error as ConnectorError).kind).toBe("not_authenticated");
  expect((error as ConnectorError).ownerDashboard).toBe("https://connector.example/dashboard");
});

test("the list comes from the session's children, even under a scope-limited grant", async () => {
  // A development grant (the reference page) requests only get_schedule, get_lunch_menu
  // and get_calendar: no list_children. The session still reports its children.
  const client = fakeClient([
    () =>
      Promise.resolve({
        schoolsoft: okSchoolsoft,
        children: [{ id: 7, firstName: "Cleo" }],
        scopes: ["get_schedule", "get_lunch_menu", "get_calendar"],
        routes: [],
        ownerDashboard: "https://connector.example/dashboard",
        connectionExpiresAt: "2026-12-31T00:00:00Z",
      }),
  ]);
  const { result } = await renderHook(() => useChildren(client, 0));
  await waitFor(() =>
    expect(result.current.state).toEqual({
      status: "list",
      children: [{ id: 7, firstName: "Cleo" }],
    }),
  );
});
