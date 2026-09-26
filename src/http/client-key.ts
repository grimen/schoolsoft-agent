/** One normalisation of "who is calling" for every per-caller limit in the adapter. */
import { ipKeyGenerator } from "express-rate-limit";

/**
 * IPv4 (including IPv4-mapped IPv6) as is; IPv6 by its /64, because one subscriber
 * controls at least a whole /64 and could otherwise rotate through it to get a fresh
 * budget per request. A request without an address shares one bucket.
 */
export function clientKey(ip: string | undefined): string {
  return ip ? ipKeyGenerator(ip, 64) : "unknown";
}
