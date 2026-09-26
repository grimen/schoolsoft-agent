/**
 * HTTP `Retry-After` (RFC 9110 §10.2.3): either a number of seconds or an
 * HTTP date. Returns the wait in milliseconds from `now`, or null when the
 * header is absent or unreadable (the caller then uses its own backoff).
 */
export function parseRetryAfter(value: string | null | undefined, now: number): number | null {
  if (value === undefined || value === null) return null;
  const text = value.trim();
  if (/^\d+$/.test(text)) return Number(text) * 1000;
  const at = Date.parse(text);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}
