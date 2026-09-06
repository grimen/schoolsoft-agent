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

export class NotAuthenticatedError extends Error {
  constructor(reason: string) {
    super(
      `Not authenticated with the school portal (${reason}). ` +
        `Call the schoolsoft_login tool — it opens the user's browser for ` +
        `BankID/password login. Do not ask the user for credentials in chat.`,
    );
    this.name = "NotAuthenticatedError";
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

  /** Interactive login via the given (or default) strategy. */
  async login(strategyId?: string): Promise<LoginInfo> {
    const strategy = strategyId ? this.strategies.get(strategyId) : this.defaultStrategy;
    if (!strategy) {
      throw new Error(
        `Unknown auth strategy "${strategyId}". Available: ` +
          [...this.strategies.keys()].join(", "),
      );
    }
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
      throw err;
    }
    this.persist(strategy.id);
    this.established = true;
    return info;
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

  status(): { saved: PersistedSession | null; established: boolean } {
    return { saved: this.store.load(), established: this.established };
  }

  /** Guardian context of the live session (children, child in focus). */
  guardian(): GuardianContext {
    const ctx = this.activeStrategy?.context;
    if (!this.established || !ctx) {
      throw new NotAuthenticatedError("no guardian context");
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
    if (!this.webLoginRunner) throw new Error("Web login is not available in this configuration.");
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
