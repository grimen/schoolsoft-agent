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
import { AgentError, InputError } from "../errors/index.js";
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
      savedAt: Date.now(),
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
      this.store.clear();
      this.reset();
      throw new NotAuthenticatedError(`restore failed: ${e instanceof Error ? e.message : e}`);
    }

    const alive = await this.getSession().verify();
    if (!alive) {
      this.store.clear();
      this.reset();
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
  }
}
