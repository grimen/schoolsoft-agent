/** Loads a served reference-page module as a browser would, around a fake browser. */
import { webcrypto } from "node:crypto";
import type { BrowserGlobals } from "../../src/http/reference/app.js";

/** Imports the module text (as the page's inline module) and boots it; returns what it rendered. */
export async function bootServed(module: string) {
  const exports = (await import(
    "data:text/javascript," + encodeURIComponent(module)
  )) as typeof import("../../src/http/reference/app.js");
  const root = { innerHTML: "", addEventListener: () => {} };
  const globals: BrowserGlobals = {
    location: {
      href: "https://connector.example/reference/",
      origin: "https://connector.example",
      assign: () => {},
    },
    history: { replaceState: () => {} },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    fetch: async () => {
      throw new Error("no request expected before connecting");
    },
    crypto: webcrypto as unknown as BrowserGlobals["crypto"],
    document: { getElementById: () => root },
  };
  await exports.boot(globals);
  return root.innerHTML;
}
