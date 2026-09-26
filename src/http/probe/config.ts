/** The probe's settings. Separate from the connector's: the probe never reads SCHOOLSOFT_*. */
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { InputError } from "../../core/index.js";
import { OWNER_PASSWORD_MAX_BYTES } from "../owner-session.js";

/** `<checkout>/.host-probe/events.jsonl`, whatever directory a host starts the probe in. */
export const DEFAULT_LOG = fileURLToPath(
  new URL("../../../.host-probe/events.jsonl", import.meta.url),
);

export function probeLogPath(env: Record<string, string | undefined>): string {
  return env.PROBE_LOG || DEFAULT_LOG;
}

export interface ProbeHttpConfig {
  publicUrl: string;
  port: number;
  proxyHops: number;
  adminPassword: string;
  /** True when no PROBE_ADMIN_PASSWORD was set and one was made up for this run. */
  generatedPassword: boolean;
}

export function probeHttpConfig(
  env: Record<string, string | undefined>,
  generate: () => string = () => randomBytes(32).toString("base64url"),
): ProbeHttpConfig {
  let url: URL;
  try {
    url = new URL(env.PROBE_PUBLIC_URL ?? "");
  } catch {
    throw new InputError("PROBE_PUBLIC_URL must be the probe's public HTTPS address");
  }
  // Plain http only on this machine: browsers treat localhost as a secure context.
  const loopback = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !loopback) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new InputError("PROBE_PUBLIC_URL must be an HTTPS origin without a path");
  const given = env.PROBE_ADMIN_PASSWORD;
  if (
    given !== undefined &&
    (given.length < 32 ||
      new Set(given).size < 8 ||
      Buffer.byteLength(given) > OWNER_PASSWORD_MAX_BYTES)
  )
    throw new InputError(
      "PROBE_ADMIN_PASSWORD must be a randomly generated value of at least 32 characters",
    );
  const port = Number(env.PROBE_PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new InputError("PROBE_PORT must be a port number");
  const proxyHops = Number(env.PROBE_PROXY_HOPS ?? 0);
  if (!Number.isInteger(proxyHops) || proxyHops < 0 || proxyHops > 2)
    throw new InputError("PROBE_PROXY_HOPS must be 0, 1 or 2");
  return {
    publicUrl: url.origin,
    port,
    proxyHops,
    adminPassword: given ?? generate(),
    generatedPassword: given === undefined,
  };
}
