// Types for dev-proxy.mjs, for the E2E (typechecked by the root's tsconfig.test.json).
import type { Server } from "node:http";

export function upstreamFor(pathname: string): "connector" | "app";
export function createProxy(
  options: { connector: URL; app: URL } | { connector: URL; staticDir: string },
): Server;
export function checkConnector(connector: URL, fetchImpl?: typeof fetch): Promise<void>;
