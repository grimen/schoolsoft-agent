/** Validate public deployment settings before opening a listener. */
import { InputError } from "../core/index.js";
export interface ConnectorConfig {
  publicUrl: string;
  proxyHops?: number;
  adminPassword: string;
  storageKey: Buffer;
  stateDir: string;
  port: number;
  school: string;
}
export function connectorConfig(env: Record<string, string | undefined>): ConnectorConfig {
  let url: URL;
  try {
    url = new URL(env.SCHOOLSOFT_PUBLIC_URL ?? "");
  } catch {
    throw new InputError("SCHOOLSOFT_PUBLIC_URL must be your HTTPS address");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new InputError("SCHOOLSOFT_PUBLIC_URL must be an HTTPS origin without a path");
  const adminPassword = env.SCHOOLSOFT_ADMIN_PASSWORD ?? "";
  if (adminPassword.length < 32)
    throw new InputError("SCHOOLSOFT_ADMIN_PASSWORD needs at least 32 characters");
  const raw = env.SCHOOLSOFT_STORAGE_KEY ?? "";
  const storageKey = /^[a-fA-F0-9]{64}$/.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");
  if (
    storageKey.length !== 32 ||
    (!/^[a-fA-F0-9]{64}$/.test(raw) && storageKey.toString("base64") !== raw)
  )
    throw new InputError("SCHOOLSOFT_STORAGE_KEY must be 32 bytes encoded as base64 or hex");
  const school = env.SCHOOLSOFT_SCHOOL ?? "";
  if (!/^[a-zA-Z0-9_-]+$/.test(school))
    throw new InputError("SCHOOLSOFT_SCHOOL must be a school address slug");
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new InputError("PORT must be a port number");
  const proxyHops = Number(env.SCHOOLSOFT_PROXY_HOPS ?? 1);
  if (!Number.isInteger(proxyHops) || proxyHops < 0 || proxyHops > 2)
    throw new InputError("SCHOOLSOFT_PROXY_HOPS must be 0, 1 or 2");
  return {
    proxyHops,
    publicUrl: url.origin,
    adminPassword,
    storageKey,
    school,
    port,
    stateDir: env.SCHOOLSOFT_STATE_DIR ?? "/data",
  };
}
