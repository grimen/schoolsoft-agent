/** Short lived owner sessions. Restarting the service signs the owner console out. */
import { randomBytes, timingSafeEqual } from "node:crypto";
export interface OwnerSession {
  csrf: string;
  expires: number;
}
/** Longest admin password in UTF-8 bytes; config.ts refuses longer ones before this is built. */
export const OWNER_PASSWORD_MAX_BYTES = 1022;
// Both sides of the comparison are laid out in one fixed-size slot, a two-byte length
// followed by the bytes and zero padding, so neither the length nor the content of the
// deployment secret is observable through timing. No hash is involved: nothing is stored,
// and the secret is a high-entropy deployment value, not a user's password. A candidate
// that is too long keeps its true (unreachable) length, so it can never match.
function slot(value: string): Buffer {
  const bytes = Buffer.from(value);
  const out = Buffer.alloc(2 + OWNER_PASSWORD_MAX_BYTES);
  out.writeUInt16BE(Math.min(bytes.length, 0xffff));
  bytes.copy(out, 2, 0, OWNER_PASSWORD_MAX_BYTES);
  return out;
}
export class OwnerSessions {
  private sessions = new Map<string, OwnerSession>();
  private readonly passwordSlot: Buffer;
  constructor(
    password: string,
    private now: () => number = Date.now,
  ) {
    this.passwordSlot = slot(password);
  }
  /** Constant-time check of a candidate; anything but a string never matches. */
  matches(password: unknown): boolean {
    return typeof password === "string" && timingSafeEqual(slot(password), this.passwordSlot);
  }
  // A correct password is never refused: any per-address refusal would let whoever
  // shares the owner's address keep the owner out. Guessing is made impractical by the
  // enforced 32+ character deployment secret, and wrong-password floods are bounded by
  // the route's rate limiter in server.ts, which requests carrying the secret bypass.
  login(password: unknown): { token: string; session: OwnerSession } | undefined {
    if (!this.matches(password)) return undefined;
    const now = this.now();
    for (const [token, session] of this.sessions)
      if (session.expires <= now) this.sessions.delete(token);
    if (this.sessions.size >= 16) this.sessions.clear();
    const token = randomBytes(32).toString("base64url");
    const session = { csrf: randomBytes(32).toString("base64url"), expires: now + 30 * 60_000 };
    this.sessions.set(token, session);
    return { token, session };
  }
  get(cookie: string | undefined): OwnerSession | undefined {
    const token = cookie
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("__Host-owner="))
      ?.slice(13);
    if (!token) return undefined;
    const session = this.sessions.get(token);
    if (session && session.expires > this.now()) return session;
    this.sessions.delete(token);
    return undefined;
  }
  logout(cookie: string | undefined): void {
    const session = this.get(cookie);
    for (const [token, candidate] of this.sessions)
      if (candidate === session) this.sessions.delete(token);
  }
  clear(): void {
    this.sessions.clear();
  }
}
