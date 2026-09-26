/**
 * Preloaded into every offline test process (package.json `--import`): a
 * request to the real school portal fails at once instead of leaving the
 * machine. The provider's live defaults (ssp-node's helper over node:https,
 * the global fetch) are one forgotten `fetchImpl` away in any test; this
 * turns that slip into a loud failure. The live suite (`make e2e`) does not
 * load it.
 */
import http from "node:http";
import https from "node:https";

const PORTAL = /(^|\.)schoolsoft\.se$/i;

function refuse(host: string): Error {
  return new Error(
    `offline test tried to reach the school portal (${host}); inject a fake fetchImpl`,
  );
}

function hostOf(target: unknown): string {
  if (typeof target === "string") return new URL(target).hostname;
  if (target instanceof URL) return target.hostname;
  const o = target as { hostname?: string; host?: string } | undefined;
  return o?.hostname ?? o?.host?.split(":")[0] ?? "";
}

type Send = (...args: unknown[]) => unknown;
for (const mod of [http, https] as unknown as Record<"request" | "get", Send>[]) {
  for (const name of ["request", "get"] as const) {
    const original = mod[name];
    mod[name] = function (this: unknown, ...args: unknown[]) {
      const host = hostOf(args[0]);
      if (PORTAL.test(host)) throw refuse(host);
      return original.apply(this, args);
    };
  }
}

const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const host = new URL(url).hostname;
  return PORTAL.test(host) ? Promise.reject(refuse(host)) : realFetch(input, init);
};
