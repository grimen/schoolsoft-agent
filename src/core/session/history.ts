/**
 * Session history: a small, bounded record of when sessions started, were
 * renewed, were used and died, so the real lifetimes of a school portal's
 * sessions can be read off after some weeks of ordinary use. It holds
 * timestamps and counters only: no tokens, no cookies, no names, no child
 * ids. It survives logout on purpose (a lifetime is only known once the
 * session is gone); deleting the state directory removes it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  loadVersioned,
  storedVersion,
  unchanged,
  writeVersioned,
  type VersionedFormat,
} from "../versioned.js";
import { accountsOf, entryOf, withAccount, type AccountsDocument } from "../accounts.js";

/** What the session manager and the portal observers report. */
export type SessionEvent =
  | { type: "login" }
  | { type: "logout" }
  | { type: "child_switch" }
  | { type: "refresh" }
  /** `since`: when the web login was made (known from the stored web session). */
  | { type: "web_login"; since: number }
  | { type: "web_use"; since: number; via: "read" | "keepalive" }
  | { type: "session_lost"; session: SessionName };

export type SessionName = "app" | "web";
export type SessionListener = (event: SessionEvent) => void;

/** One live session: activity is a token refresh (app) or a read/touch (web). */
export interface SessionSpan {
  /** Null when the session predates the history file. */
  startedAt: number | null;
  lastActivityAt: number;
  activityCount: number;
  /** Longest pause between two activities that the session survived. */
  longestGapMs: number;
}

export interface SessionLoss {
  session: SessionName;
  at: number;
  ageMs: number | null;
  idleMs: number;
  activityCount: number;
  longestGapMs: number;
}

/** One account's history (the file was written as `version: 1` from the start; v2 keys it by account). */
export interface SessionHistory {
  app: SessionSpan | null;
  web: SessionSpan | null;
  losses: SessionLoss[];
  events: { type: string; at: number }[];
}

export interface SessionHistoryStore {
  read(): SessionHistory | null;
  write(history: SessionHistory): void;
}

export const MAX_HISTORY_EVENTS = 300;
export const MAX_HISTORY_LOSSES = 50;

export function emptyHistory(): SessionHistory {
  return { app: null, web: null, losses: [], events: [] };
}

/**
 * The history file from v2 on: one history per account. A v1 history said
 * nothing about the school it was recorded for; it waits as `legacy` until an
 * account without an entry of its own records an event, and then is that
 * account's (for a single-account user: theirs).
 */
export interface HistoryDocument extends AccountsDocument<SessionHistory> {
  legacy?: SessionHistory;
}

/** v1 → v2: keep the history as the legacy record (see HistoryDocument). */
export function keepLegacyHistory(raw: SessionHistory & { version?: unknown }): HistoryDocument {
  const { version: _version, ...legacy } = raw;
  return { accounts: {}, legacy };
}

/** The history's format (local session-history.json and the connector's encrypted history). */
export const HISTORY_FORMAT: VersionedFormat = { migrations: [unchanged, keepLegacyHistory] };

/** An account's history; an account without one sees the legacy record, if any. */
export function historyOf(doc: HistoryDocument | null, account: string): SessionHistory | null {
  return entryOf<SessionHistory>(doc, account) ?? doc?.legacy ?? null;
}

/** Store an account's history. Its first entry claims the legacy record, which it was shown. */
export function withHistory(
  doc: HistoryDocument | null,
  account: string,
  history: SessionHistory,
): HistoryDocument {
  const base: HistoryDocument = doc ?? { accounts: {} };
  if (entryOf(base, account) !== undefined) return withAccount(base, account, history);
  const { legacy: _claimed, ...rest } = base;
  return withAccount(rest, account, history);
}

export class MemorySessionHistoryStore implements SessionHistoryStore {
  private value: SessionHistory | null = null;
  read(): SessionHistory | null {
    return this.value;
  }
  write(history: SessionHistory): void {
    this.value = history;
  }
}

/**
 * One account's view of a keyed history document (the local file and the
 * connector's encrypted history). Writing re-reads the document first, so the
 * other accounts' entries are kept.
 */
export function accountHistoryStore(
  repo: { read(): HistoryDocument | null; write(doc: HistoryDocument): void },
  account: string,
): SessionHistoryStore {
  return {
    read: () => historyOf(repo.read(), account),
    write: (history) => repo.write(withHistory(repo.read(), account, history)),
  };
}

/** `session-history.json` in the state directory (0600; contains no credentials), one history per account. */
export class FileSessionHistoryStore implements SessionHistoryStore {
  private readonly entry: SessionHistoryStore;
  constructor(
    private readonly dir: string,
    /** The account this store reads and writes (accountKey). */
    readonly account: string,
  ) {
    this.entry = accountHistoryStore(
      { read: () => this.document(), write: (doc) => this.writeDocument(doc) },
      account,
    );
  }
  private get path(): string {
    return join(this.dir, "session-history.json");
  }
  /** Unreadable reads as nothing (the next event starts afresh); a newer file throws and is left alone. */
  private document(): HistoryDocument | null {
    if (!existsSync(this.path)) return null;
    return loadVersioned<HistoryDocument, null>(
      HISTORY_FORMAT,
      this.path,
      () => JSON.parse(readFileSync(this.path, "utf8")),
      () => null,
    );
  }
  private writeDocument(doc: HistoryDocument): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    writeFileSync(this.path, JSON.stringify(writeVersioned(HISTORY_FORMAT, doc)), {
      mode: 0o600,
    });
  }
  read(): SessionHistory | null {
    return this.entry.read();
  }
  write(history: SessionHistory): void {
    this.entry.write(history);
  }
  /** The keys of every account with a history of its own (doctor). */
  accounts(): string[] {
    return Object.keys(accountsOf(this.document()));
  }
  /** The format version on disk (0 before versions existed); null when absent or unreadable. */
  storedVersion(): number | null {
    if (!existsSync(this.path)) return null;
    try {
      return storedVersion(JSON.parse(readFileSync(this.path, "utf8")));
    } catch {
      return null;
    }
  }
}

function touched(span: SessionSpan | null, at: number, startedAt: number | null): SessionSpan {
  if (!span) return { startedAt, lastActivityAt: at, activityCount: 1, longestGapMs: 0 };
  return {
    startedAt: span.startedAt,
    lastActivityAt: at,
    activityCount: span.activityCount + 1,
    longestGapMs: Math.max(span.longestGapMs, at - span.lastActivityAt),
  };
}

function fresh(at: number): SessionSpan {
  return { startedAt: at, lastActivityAt: at, activityCount: 0, longestGapMs: 0 };
}

/** Applies events to the stored history; every write is bounded. */
export class SessionHistoryRecorder {
  constructor(
    private readonly store: SessionHistoryStore,
    private readonly now: () => number,
  ) {}

  read(): SessionHistory {
    return this.store.read() ?? emptyHistory();
  }

  /** How long the named session has been idle, null when it is not being tracked. */
  idleMs(session: SessionName): number | null {
    let span: SessionSpan | null;
    try {
      span = this.read()[session];
    } catch {
      return null; // e.g. a history file from a newer build: the loss itself must still be reported
    }
    return span ? this.now() - span.lastActivityAt : null;
  }

  /** Best effort: a state directory that cannot be written must never break a login or a read. */
  record(event: SessionEvent): void {
    try {
      this.apply(event);
    } catch {
      /* measuring is optional; the session is not */
    }
  }

  private apply(event: SessionEvent): void {
    if (event.type === "child_switch") return; // not a lifetime fact, and nothing about children is kept
    const at = this.now();
    const h = this.read();
    switch (event.type) {
      case "login":
        h.app = fresh(at);
        break;
      case "refresh":
        h.app = touched(h.app, at, null);
        break;
      case "web_login":
        h.web = fresh(event.since);
        break;
      case "web_use":
        h.web = touched(h.web, at, event.since);
        break;
      case "logout":
        h.app = null;
        h.web = null;
        break;
      case "session_lost": {
        const span = h[event.session];
        if (!span) return; // already recorded; a dead session is reported once
        h.losses.push({
          session: event.session,
          at,
          ageMs: span.startedAt === null ? null : at - span.startedAt,
          idleMs: at - span.lastActivityAt,
          activityCount: span.activityCount,
          longestGapMs: span.longestGapMs,
        });
        h[event.session] = null;
        break;
      }
    }
    h.events.push({
      type: event.type === "session_lost" ? `${event.session}_lost` : event.type,
      at,
    });
    h.events = h.events.slice(-MAX_HISTORY_EVENTS);
    h.losses = h.losses.slice(-MAX_HISTORY_LOSSES);
    this.store.write(h);
  }
}

const minutes = (ms: number): number => Math.round(ms / 60_000);
const iso = (ms: number): string => new Date(ms).toISOString();

function describeSpan(span: SessionSpan | null, now: number) {
  if (!span) return null;
  return {
    since: span.startedAt === null ? null : iso(span.startedAt),
    ageMinutes: span.startedAt === null ? null : minutes(now - span.startedAt),
    lastActivity: iso(span.lastActivityAt),
    idleMinutes: minutes(now - span.lastActivityAt),
    activityCount: span.activityCount,
    longestGapSurvivedMinutes: minutes(span.longestGapMs),
  };
}

/** What auth_status and doctor show: the live sessions and the last ten observed losses. */
export function summarizeHistory(history: SessionHistory, now: number) {
  return {
    recordedSince: history.events.length ? iso(history.events[0].at) : null,
    app: describeSpan(history.app, now),
    web: describeSpan(history.web, now),
    losses: history.losses.slice(-10).map((l) => ({
      session: l.session,
      at: iso(l.at),
      ageMinutes: l.ageMs === null ? null : minutes(l.ageMs),
      idleMinutes: minutes(l.idleMs),
      activityCount: l.activityCount,
      longestGapSurvivedMinutes: minutes(l.longestGapMs),
    })),
  };
}

export type SessionHistorySummary = ReturnType<typeof summarizeHistory>;
