/**
 * A small marker for a login that is running in another process or in the
 * background: when it started, the URL the user must open, and how it
 * ended. It lets `login --background` return at once (hosts with short
 * command timeouts), `auth-status` report progress, and a second `login`
 * refuse to open a second browser window.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface PendingBase {
  startedAt: number;
  /** Process that runs the login; lets a reader tell a crash from a slow user. */
  pid?: number;
  /** Login URL once the browser flow has produced it. */
  url?: string;
}
export type PendingLogin =
  | (PendingBase & { state: "running"; error?: undefined })
  | (PendingBase & { state: "failed"; error: string });

export interface PendingLoginStore {
  read(): PendingLogin | null;
  write(p: PendingLogin): void;
  clear(): void;
}

export class MemoryPendingLoginStore implements PendingLoginStore {
  private value: PendingLogin | null = null;
  read(): PendingLogin | null {
    return this.value;
  }
  write(p: PendingLogin): void {
    this.value = p;
  }
  clear(): void {
    this.value = null;
  }
}

/** `login-pending.json` in the state directory (0600; contains no credentials). */
export class FilePendingLoginStore implements PendingLoginStore {
  constructor(private readonly dir: string) {}
  private get path(): string {
    return join(this.dir, "login-pending.json");
  }
  read(): PendingLogin | null {
    if (!existsSync(this.path)) return null;
    try {
      return JSON.parse(readFileSync(this.path, "utf8")) as PendingLogin;
    } catch {
      return null;
    }
  }
  write(p: PendingLogin): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    writeFileSync(this.path, JSON.stringify(p), { mode: 0o600 });
  }
  clear(): void {
    if (existsSync(this.path)) rmSync(this.path);
  }
}

/** A running login older than this is treated as abandoned. */
export const PENDING_LOGIN_TTL_MS = 6 * 60_000;
