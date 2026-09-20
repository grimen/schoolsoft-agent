/** Short lived owner sessions. Restarting the service signs the owner console out. */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
export interface OwnerSession {
  csrf: string;
  expires: number;
}
export class OwnerSessions {
  private sessions = new Map<string, OwnerSession>();
  // Per-process random key for the comparison MAC below; never persisted.
  private readonly compareKey = randomBytes(32);
  private readonly passwordMac: Buffer;
  constructor(
    password: string,
    private now: () => number = Date.now,
  ) {
    this.passwordMac = this.mac(password);
  }
  // Keyed MAC used only to give both sides of the comparison the same fixed length, so
  // neither the length nor the content of the deployment secret is observable through
  // timing. This is not password storage: nothing is persisted, the key is random per
  // process, and the secret is a high-entropy deployment value (32+ characters), so a
  // slow password hash would add login latency without protecting anything at rest.
  private mac(value: string): Buffer {
    return createHmac("sha256", this.compareKey).update(value).digest();
  }
  /** Constant-time check of a candidate; anything but a string never matches. */
  matches(password: unknown): boolean {
    return typeof password === "string" && timingSafeEqual(this.mac(password), this.passwordMac);
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
