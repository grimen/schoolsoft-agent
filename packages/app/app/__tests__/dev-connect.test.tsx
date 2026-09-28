import type { ReactElement } from "react";

jest.mock("expo-router", () => ({ Redirect: () => null }));

const g = globalThis as unknown as { __DEV__: boolean };
const DEV = g.__DEV__;
afterEach(() => {
  g.__DEV__ = DEV;
});
function StubDevConnect() {
  return null;
}

/**
 * The route reads `__DEV__` when its module loads, so each build flavour loads it afresh.
 * Its component has no hooks, so calling it shows what it renders without a renderer.
 */
function loadRoute(dev: boolean) {
  g.__DEV__ = dev;
  const devScreenLoaded = jest.fn();
  let route!: () => ReactElement<Record<string, unknown>>;
  let redirect!: unknown;
  jest.isolateModules(() => {
    jest.doMock("../../src/dev/DevConnect", () => {
      devScreenLoaded();
      return { DevConnect: StubDevConnect };
    });
    route = (require("../dev-connect") as { default: typeof route }).default;
    redirect = (require("expo-router") as { Redirect: unknown }).Redirect;
  });
  return { element: route(), redirect, devScreenLoaded: devScreenLoaded.mock.calls.length > 0 };
}

test("a production build redirects /dev-connect to / and never loads the development screen", () => {
  const { element, redirect, devScreenLoaded } = loadRoute(false);
  expect(element.type).toBe(redirect);
  expect(element.props).toEqual({ href: "/" });
  expect(devScreenLoaded).toBe(false);
});

test("a development build renders the development screen", () => {
  const { element, devScreenLoaded } = loadRoute(true);
  expect(devScreenLoaded).toBe(true);
  expect(element.type).toBe(StubDevConnect);
});
