/**
 * A small marker for a login that is running in another process or in the
 * background: when it started, the URL the user must open, and how it
 * ended. It lets `login --background` return at once (hosts with short
 * command timeouts), `auth-status` report progress, and a second `login`
 * refuse to open a second browser window.
 *
 * One marker per state directory, not per account: the callback port and
 * the user's browser are shared, so a second BankID login waits whatever
 * the school (docs/planning/specs/2026-09-26-accounts-by-school.md).
 */
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { SealedStateFiles } from "./sealed.js";

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

export const PENDING_LOGIN_FILE = "login-pending.enc";
/** The plaintext marker of builds before E10.4: never read, removed on the next write or clear. */
export const LEGACY_PENDING_LOGIN_FILE = "login-pending.json";

/**
 * `login-pending.enc` in the state directory, sealed with key.bin (sealed.ts):
 * it holds the login URL and a failure message. Unversioned: it lives
 * minutes, and anything unreadable reads as "no login running".
 */
export class FilePendingLoginStore implements PendingLoginStore {
  private readonly sealed: SealedStateFiles;
  constructor(private readonly dir: string) {
    this.sealed = new SealedStateFiles(dir);
  }
  private get path(): string {
    return join(this.dir, PENDING_LOGIN_FILE);
  }
  read(): PendingLogin | null {
    if (!existsSync(this.path)) return null;
    try {
      return this.sealed.read(PENDING_LOGIN_FILE) as PendingLogin;
    } catch {
      return null;
    }
  }
  write(p: PendingLogin): void {
    this.sealed.write(PENDING_LOGIN_FILE, p);
    this.removeLegacy();
  }
  clear(): void {
    rmSync(this.path, { force: true });
    this.removeLegacy();
  }
  private removeLegacy(): void {
    rmSync(join(this.dir, LEGACY_PENDING_LOGIN_FILE), { force: true });
  }
}

/** A running login older than this is treated as abandoned. */
export const PENDING_LOGIN_TTL_MS = 6 * 60_000;
