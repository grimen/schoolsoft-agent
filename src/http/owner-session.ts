/** Short lived owner sessions. Restarting the service signs the owner console out. */
import { randomBytes, timingSafeEqual } from "node:crypto";
export interface OwnerSession {
  csrf: string;
  expires: number;
}
export class OwnerSessions {
  private sessions = new Map<string, OwnerSession>();
  private readonly passwordBytes: Buffer;
  private attempts = new Map<string, number[]>();
  constructor(
    password: string,
    private now: () => number = Date.now,
  ) {
    this.passwordBytes = Buffer.from(password);
  }
  login(password: unknown, client = "local"): { token: string; session: OwnerSession } | undefined {
    const now = this.now();
    const attempts = (this.attempts.get(client) ?? []).filter((t) => t > now - 60_000);
    if (attempts.length >= 5) return undefined;
    if (this.attempts.size >= 1024) this.attempts.delete(this.attempts.keys().next().value!);
    this.attempts.set(client, [...attempts, now]);
    // This is a high-entropy deployment secret, not a stored user-password hash.
    if (typeof password !== "string") return undefined;
    const candidate = Buffer.from(password);
    if (
      candidate.length !== this.passwordBytes.length ||
      !timingSafeEqual(candidate, this.passwordBytes)
    )
      return undefined;
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
