import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ConnectorClient } from "schoolsoft-agent/client";
import { useChildren } from "../use-children";

function fakeClient(answers: Array<() => Promise<unknown>>): ConnectorClient {
  let i = 0;
  return {
    children: () => answers[Math.min(i++, answers.length - 1)]!(),
  } as unknown as ConnectorClient;
}
// A macrotask delay: `act()` drains pending microtasks eagerly, so an answer that
// resolves on the microtask queue lands before an awaited render/rerender returns,
// making the transitional "loading" state unobservable. A `setTimeout` keeps it real.
const list = (names: string[]) => () =>
  new Promise<unknown>((resolve) =>
    setTimeout(
      () =>
        resolve({
          children: names.map((firstName, id) => ({ id, firstName })),
          childInFocus: null,
        }),
      5,
    ),
  );

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
      (r) => (release = () => r({ children: [{ id: 1, firstName: "Old" }], childInFocus: null })),
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
