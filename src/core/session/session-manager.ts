/**
 * SessionManager: the single owner of the session lifecycle, generic over
 * the provider's session object (credentials holder). All dependencies
 * are injected (store, strategies, session factory, serializer) so tests
 * construct their own instance with MemorySessionStore and fakes — no
 * disk, no network. Production wiring lives in wiring.ts.
 */
import type { AuthStrategy, LoginInfo } from "../auth/strategy.js";
import type { PersistedSession, SessionStore } from "./store.js";
import { childOf, type GuardianContext } from "../portal/guardian.js";
import type { WebSession } from "../browser/web-login.js";
import type { ProviderSession } from "../provider/types.js";
import { AgentError, InputError, keepsSession } from "../errors/index.js";
import {
  summarizeHistory,
  type SessionEvent,
  type SessionHistoryRecorder,
  type SessionHistorySummary,
  type SessionListener,
} from "./history.js";
import {
  PENDING_LOGIN_TTL_MS,
  type PendingLogin,
  type PendingLoginStore,
} from "./pending-login.js";

export class NotAuthenticatedError extends AgentError {
  constructor(
    reason: string,
    key: "not_authenticated" | "session_rejected_twice" = "not_authenticated",
  ) {
    super({ kind: "not_authenticated", key, params: { reason }, hint: "login" });
  }
}

/** Refresh this long before the access credential expires (keepalive). */
export const RENEW_LEAD_MS = 3 * 60_000;

export interface SessionManagerOptions<S extends ProviderSession> {
  school: string;
  /** Provider id, stored with the session so a later run can refuse a foreign file. */
  provider?: string;
  store: SessionStore;
  /** First entry is the default login strategy. */
  strategies: AuthStrategy<S>[];
  /** Creates the provider's live session object for a school. */
  createSession: (school: string) => S;
  /** Provider-owned credentials to persist (`PersistedSession.data`). */
  serialize: (session: S) => Record<string, unknown>;
  /** Runs the interactive web login (headed browser); injected so core stays free of playwright. */
  webLogin?: (school: string) => Promise<WebSession>;
  /** Where a login in progress is recorded (see pending-login.ts). Optional: no marker, no background login. */
  pending?: PendingLoginStore;
  /** Clock and process id, injectable for tests. */
  now?: () => number;
  pid?: number;
  /** Is a process alive? Used to tell an abandoned login from a slow user. */
  isAlive?: (pid: number) => boolean;
  /** Where session lifetimes are recorded; absent: nothing is recorded. */
  history?: SessionHistoryRecorder;
  /** Told about logins, refreshes, child switches, web-session use and losses (history, cache). */
  onEvent?: SessionListener;
}

export class SessionManager<S extends ProviderSession = ProviderSession> {
  private readonly school: string;
  readonly providerId: string;
  private readonly store: SessionStore;
  private readonly strategies: Map<string, AuthStrategy<S>>;
  private readonly defaultStrategy: AuthStrategy<S>;
  private readonly createSession: (school: string) => S;
  private readonly serialize: (session: S) => Record<string, unknown>;

  private session: S | null = null;
  private established = false;
  private web: WebSession | null = null;
  private readonly webLoginRunner?: (school: string) => Promise<WebSession>;
  private readonly pending?: PendingLoginStore;
  private readonly now: () => number;
  private readonly pid: number;
  private readonly isAlive: (pid: number) => boolean;
  private inFlight: Promise<LoginInfo> | null = null;
  private readonly listeners: SessionListener[] = [];
  private readonly history?: SessionHistoryRecorder;
  private lock: Promise<unknown> = Promise.resolve();

  constructor(options: SessionManagerOptions<S>) {
    if (options.strategies.length === 0) {
      throw new Error("SessionManager requires at least one AuthStrategy");
    }
    this.school = options.school;
    this.providerId = options.provider ?? "schoolsoft";
    this.store = options.store;
    this.strategies = new Map(options.strategies.map((s) => [s.id, s]));
    this.defaultStrategy = options.strategies[0];
    this.createSession = options.createSession;
    this.serialize = options.serialize;
    this.webLoginRunner = options.webLogin;
    this.pending = options.pending;
    this.now = options.now ?? Date.now;
    this.pid = options.pid ?? 0;
    this.isAlive = options.isAlive ?? (() => true);
    this.web = this.store.load()?.web ?? null;
    this.history = options.history;
    if (options.onEvent) this.listeners.push(options.onEvent);
  }

  /** Add a listener for session events; returns the function that removes it. */
  subscribe(listener: SessionListener): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  private emit(event: SessionEvent): void {
    this.history?.record(event);
    // A copy: a listener may unsubscribe while being told.
    for (const listener of this.listeners.slice()) listener(event);
  }

  /** One restore or renewal at a time: two callers must never spend the same refresh token. */
  private exclusive<T>(run: () => Promise<T>): Promise<T> {
    const result = this.lock.then(run);
    this.lock = result.catch(() => {});
    return result;
  }

  /**
   * The provider rotated its credentials (AuthDeps.onRefresh): persist them
   * at once, keeping the saved guardian and web session, because the steps
   * that follow a refresh can still fail and the old refresh token is spent.
   */
  noteRefresh(): void {
    const saved = this.store.load();
    if (saved) {
      this.store.save({ ...saved, data: this.serialize(this.getSession()), savedAt: this.now() });
    }
    this.emit({ type: "refresh" });
  }

  /** A capability that rides on the web session answered (a read, or the keepalive touch). */
  noteWebUse(via: "read" | "keepalive"): void {
    if (this.web) this.emit({ type: "web_use", since: this.web.savedAt, via });
  }

  /** The portal sent the web session to its login page. Returns how long it had been idle, when known. */
  noteWebSessionLost(): number | null {
    const idle = this.history?.idleMs("web") ?? null;
    this.emit({ type: "session_lost", session: "web" });
    return idle;
  }

  /** Observed session lifetimes (timestamps and counters only); null when nothing records them. */
  sessionHistory(): SessionHistorySummary | null {
    return this.history ? summarizeHistory(this.history.read(), this.now()) : null;
  }

  /** The provider's live session object (created lazily, never null). */
  getSession(): S {
    if (!this.session) this.session = this.createSession(this.school);
    return this.session;
  }

  private reset(): void {
    this.session = null;
    this.established = false;
    this.activeStrategy = null;
  }

  private persist(authMethod: string): void {
    const strategy = this.strategies.get(authMethod);
    this.store.save({
      provider: this.providerId,
      school: this.school,
      data: this.serialize(this.getSession()),
      guardian: strategy?.context,
      web: this.web ?? undefined,
      savedAt: this.now(),
      authMethod,
    });
  }

  /**
   * The login in progress, if any: a fresh "running" entry from this or
   * another live process, or a recent "failed" one. Abandoned entries (dead
   * process, or older than the TTL) are cleared and reported as null.
   */
  pendingLogin(): PendingLogin | null {
    const p = this.pending?.read() ?? null;
    if (!p) return null;
    const stale = this.now() - p.startedAt > PENDING_LOGIN_TTL_MS;
    const dead =
      p.state === "running" && p.pid !== undefined && p.pid !== this.pid && !this.isAlive(p.pid);
    if (stale || dead) {
      this.pending?.clear();
      return null;
    }
    return p;
  }

  /** Record the URL the browser flow opened, so a caller that did not wait can show it. */
  noteLoginUrl(url: string): void {
    const p = this.pending?.read();
    if (p && p.state === "running") this.pending?.write({ ...p, url });
  }

  /** Interactive login via the given (or default) strategy. */
  async login(strategyId?: string): Promise<LoginInfo> {
    if (this.inFlight) return this.inFlight;
    const strategy = strategyId ? this.strategies.get(strategyId) : this.defaultStrategy;
    if (!strategy) {
      throw new InputError(
        `unknown auth strategy "${strategyId}"; available: ${[...this.strategies.keys()].join(", ")}`,
      );
    }
    const other = this.pendingLogin();
    if (other && other.state === "running" && other.pid !== this.pid) {
      throw new AgentError({
        kind: "not_authenticated",
        key: "login_in_progress",
        hint: "wait_for_login",
      });
    }
    this.pending?.write({ state: "running", startedAt: this.now(), pid: this.pid });
    this.inFlight = this.runLogin(strategy).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async runLogin(strategy: AuthStrategy<S>): Promise<LoginInfo> {
    this.reset();
    this.activeStrategy = strategy;
    let info: LoginInfo;
    try {
      info = await strategy.login(this.getSession());
    } catch (err) {
      // If the interactive part (BankID) already yielded tokens and a
      // later step failed, keep the tokens: restore() can retry the rest
      // without asking the user to authenticate again.
      if (Object.keys(this.serialize(this.getSession())).length > 0) {
        this.persist(strategy.id);
      }
      const marker = this.pending?.read();
      this.pending?.write({
        state: "failed",
        startedAt: marker?.startedAt ?? this.now(),
        pid: this.pid,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
    this.persist(strategy.id);
    this.established = true;
    this.pending?.clear();
    this.emit({ type: "login" });
    return info;
  }

  /**
   * Start a login without waiting for the user: resolves as soon as the
   * login URL is known (or after `urlTimeoutMs`), while the login keeps
   * running in this process. Failures are recorded in the pending marker,
   * where `pendingLogin()` and auth-status surface them.
   */
  async startLogin(
    strategyId?: string,
    urlTimeoutMs = 5000,
    sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ): Promise<{ url?: string; startedAt: number }> {
    const started = this.now();
    const running = this.login(strategyId);
    running.catch(() => {
      /* recorded in the pending marker by runLogin */
    });
    const deadline = started + urlTimeoutMs;
    for (;;) {
      const p = this.pendingLogin();
      if (p?.url) return { url: p.url, startedAt: p.startedAt };
      if (p?.state === "failed")
        throw new AgentError({
          kind: "not_authenticated",
          key: "not_authenticated",
          params: { reason: p.error },
          hint: "login",
        });
      if (!p || this.now() >= deadline) return { startedAt: p?.startedAt ?? started };
      await sleep(50);
    }
  }

  /**
   * Ensure an authenticated session: reuse the live one, else restore
   * from the store via the strategy that created it. Throws
   * NotAuthenticatedError with agent-actionable guidance otherwise.
   */
  async ensureSession(): Promise<S> {
    if (this.established) {
      return this.getSession();
    }
    return this.exclusive(() => this.restoreSaved());
  }

  private async restoreSaved(): Promise<S> {
    if (this.established) return this.getSession(); // a caller ahead in the queue restored it

    const saved = this.store.load();
    if (!saved) {
      throw new NotAuthenticatedError("no saved session");
    }
    if (saved.school !== this.school) {
      this.store.clear();
      throw new NotAuthenticatedError(
        `saved session is for school "${saved.school}", not "${this.school}"`,
      );
    }
    if (saved.provider !== undefined && saved.provider !== this.providerId) {
      this.store.clear();
      throw new NotAuthenticatedError(
        `saved session is for provider "${saved.provider}", not "${this.providerId}"`,
      );
    }

    const strategy = this.strategies.get(saved.authMethod) ?? this.defaultStrategy;
    this.activeStrategy = strategy;
    try {
      await strategy.restore(this.getSession(), saved);
      this.persist(strategy.id); // tokens may have been refreshed
    } catch (e) {
      this.reset();
      if (keepsSession(e)) throw e; // the saved session may be fine; keep it
      this.loseAppSession();
      throw new NotAuthenticatedError(`restore failed: ${e instanceof Error ? e.message : e}`);
    }

    const alive = await this.getSession().verify();
    if (!alive) {
      this.reset();
      this.loseAppSession();
      throw new NotAuthenticatedError("session expired");
    }

    this.established = true;
    return this.getSession();
  }

  /**
   * The session was rejected mid-conversation: forget the live state and
   * restore from the store again (refreshing tokens, re-exchanging cookies).
   * Throws NotAuthenticatedError when nothing usable remains.
   */
  async reauthenticate(): Promise<S> {
    this.established = false;
    this.activeStrategy = null;
    return this.ensureSession();
  }

  private loseAppSession(): void {
    this.store.clear();
    this.emit({ type: "session_lost", session: "app" });
  }

  /**
   * Keepalive: renew the saved credentials before they expire, with no user
   * interaction and never a login. Works from the store, so tokens rotated
   * by another process are adopted rather than fought over. A transient
   * failure leaves everything as it was; a rejection means the session is
   * gone, which is recorded and reported as NotAuthenticatedError.
   */
  renew(leadMs = RENEW_LEAD_MS): Promise<{ expiresAt: number | null }> {
    return this.exclusive(async () => {
      const saved = this.store.load();
      if (
        !saved ||
        saved.school !== this.school ||
        (saved.provider !== undefined && saved.provider !== this.providerId)
      ) {
        throw new NotAuthenticatedError("no saved session");
      }
      const strategy = this.strategies.get(saved.authMethod) ?? this.defaultStrategy;
      try {
        return await strategy.renew(this.getSession(), saved, { now: this.now(), leadMs });
      } catch (e) {
        if (keepsSession(e)) throw e;
        // Another process (a CLI command next to the MCP server) may have rotated the
        // credentials while we tried: its tokens are the live ones. Keep them, try later.
        const current = this.store.load();
        if (current && JSON.stringify(current.data) !== JSON.stringify(saved.data)) {
          return { expiresAt: null };
        }
        this.reset();
        this.loseAppSession();
        throw new NotAuthenticatedError(`renewal failed: ${e instanceof Error ? e.message : e}`);
      }
    });
  }

  status(): { saved: PersistedSession | null; established: boolean } {
    return { saved: this.store.load(), established: this.established };
  }

  /** Guardian context of the live session (children, child in focus). */
  guardian(): GuardianContext {
    const ctx = this.activeStrategy?.context;
    if (!this.established || !ctx) {
      throw new NotAuthenticatedError("no guardian context yet");
    }
    return ctx;
  }

  /** Re-bind the cookie session to another child and persist the choice. */
  async focusChild(studentId: number): Promise<GuardianContext> {
    const session = await this.ensureSession();
    const strategy = this.activeStrategy!; // set by ensureSession()
    childOf(this.guardian(), studentId); // validate before any side effect
    if (strategy.context?.childInFocus !== studentId) {
      await strategy.focusChild(session, studentId);
      this.persist(strategy.id);
      this.emit({ type: "child_switch" });
    }
    return this.guardian();
  }

  private activeStrategy: AuthStrategy<S> | null = null;

  /** The web-login session, if one was stored (may be expired; the browser finds out). */
  getWebSession(): WebSession | null {
    return this.web;
  }

  /** Interactive web login (BankID/SAML in a headed browser); stores the cookies. */
  async webLogin(): Promise<{ status: "web_logged_in"; landedOn: string; cookies: number }> {
    if (!this.webLoginRunner)
      throw new AgentError({ kind: "not_available", key: "web_login_unavailable" });
    const web = await this.webLoginRunner(this.school);
    this.web = web;
    const saved = this.store.load();
    if (saved) this.store.save({ ...saved, web });
    this.emit({ type: "web_login", since: web.savedAt });
    return { status: "web_logged_in", landedOn: web.landedOn, cookies: web.cookies.length };
  }

  /** Forget the web session only (e.g. after SchoolSoft rejected it). */
  clearWebSession(): void {
    this.web = null;
    const saved = this.store.load();
    if (saved) this.store.save({ ...saved, web: undefined });
  }

  logout(): void {
    this.store.clear();
    this.web = null;
    this.reset();
    this.emit({ type: "logout" });
  }
}
