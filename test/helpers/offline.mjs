/**
 * Preloaded into every offline test process (`--import` in the `test` and
 * `coverage` scripts and in the artifact E2E): a request to the real school
 * portal fails at once instead of leaving the machine. The provider's live
 * defaults (ssp-node's helper over node:https, the global fetch) are one
 * forgotten `fetchImpl` away in any test; this turns that slip into a loud
 * failure. The live suite (`make e2e`) does not load it.
 *
 * Plain JavaScript on purpose: it also adds itself to NODE_OPTIONS, so a
 * child process a test spawns with the inherited environment (the built CLI,
 * the MCP server, the connector) is guarded too, and a plain `node` child
 * cannot load TypeScript.
 */
import http from "node:http";
import https from "node:https";

const PORTAL = /(^|\.)schoolsoft\.se$/i;

function refuse(host) {
  return new Error(
    `offline test tried to reach the school portal (${host}); inject a fake fetchImpl`,
  );
}

function hostOf(target) {
  if (typeof target === "string") return new URL(target).hostname;
  if (target instanceof URL) return target.hostname;
  return target?.hostname ?? target?.host?.split(":")[0] ?? "";
}

for (const mod of [http, https]) {
  for (const name of ["request", "get"]) {
    const original = mod[name];
    mod[name] = function (...args) {
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

const self = `--import=${import.meta.url}`;
const options = process.env.NODE_OPTIONS ?? "";
if (!options.includes(self)) process.env.NODE_OPTIONS = `${options} ${self}`.trim();
