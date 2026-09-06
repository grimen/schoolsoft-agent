/**
 * SessionManager: the single owner of client + session lifecycle.
 *
 * All dependencies are injected (store, strategies, client factory) so
 * tests construct their own instance with MemorySessionStore and a fake
 * client factory — no disk, no network. Production wiring lives in
 * client.ts.
 */
import { SchoolsoftClient } from "@elias4044/ssp-node";
import type { AuthStrategy, LoginInfo } from "../auth/strategy.js";
import type { PersistedSession, SessionStore } from "./store.js";
import { childOf, type GuardianContext } from "../portal/api-portal.js";
import { decodeJwtClaims } from "../auth/oauth.js";
import type { WebSession } from "../browser/web-login.js";

export class NotAuthenticatedError extends Error {
  constructor(reason: string) {
    super(
      `Not authenticated with SchoolSoft (${reason}). ` +
        `Call the schoolsoft_login tool — it opens the user's browser for ` +
        `BankID/password login. Do not ask the user for credentials in chat.`,
    );
    this.name = "NotAuthenticatedError";
  }
}

export interface SessionManagerOptions {
  school: string;
  store: SessionStore;
  /** First entry is the default login strategy. */
  strategies: AuthStrategy[];
  clientFactory?: (school: string) => SchoolsoftClient;
  /** Runs the interactive web login (headed browser); injected so core stays free of playwright. */
  webLogin?: (school: string) => Promise<WebSession>;
}

export class SessionManager {
  private readonly school: string;
  private readonly store: SessionStore;
  private readonly strategies: Map<string, AuthStrategy>;
  private readonly defaultStrategy: AuthStrategy;
  private readonly clientFactory: (school: string) => SchoolsoftClient;

  private client: SchoolsoftClient | null = null;
  private established = false;
  private web: WebSession | null = null;
  private readonly webLoginRunner?: (school: string) => Promise<WebSession>;

  constructor(options: SessionManagerOptions) {
    if (options.strategies.length === 0) {
      throw new Error("SessionManager requires at least one AuthStrategy");
    }
    this.school = options.school;
    this.store = options.store;
    this.strategies = new Map(options.strategies.map((s) => [s.id, s]));
    this.defaultStrategy = options.strategies[0];
    this.clientFactory = options.clientFactory ?? ((school) => new SchoolsoftClient({ school }));
    this.webLoginRunner = options.webLogin;
    this.web = this.store.load()?.web ?? null;
  }

  getClient(): SchoolsoftClient {
    if (!this.client) {
      this.client = this.clientFactory(this.school);
    }
    return this.client;
  }

  private reset(): void {
    this.client = null;
    this.established = false;
    this.activeStrategy = null;
  }

  private persist(authMethod: string): void {
    const c = this.getClient();
    const strategy = this.strategies.get(authMethod);
    this.store.save({
      school: this.school,
      guardian: strategy?.context,
      web: this.web ?? undefined,
      accessToken: c.accessToken ?? undefined,
      refreshToken: c.refreshToken ?? undefined,
      // ssp-node exposes no expiry getter; the JWT carries it (unix seconds).
      accessTokenExpiresAt: c.accessToken ? decodeJwtClaims(c.accessToken)?.exp : undefined,
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
      info = await strategy.login(this.getClient());
    } catch (err) {
      // If the interactive part (BankID) already yielded tokens and a
      // later step failed, keep the tokens: restore() can retry the rest
      // without asking the user to authenticate again.
      if (this.getClient().accessToken) {
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
  async ensureSession(): Promise<SchoolsoftClient> {
    if (this.established) {
      return this.getClient();
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

    const strategy = this.strategies.get(saved.authMethod) ?? this.defaultStrategy;
    this.activeStrategy = strategy;
    try {
      await strategy.restore(this.getClient(), saved);
      this.persist(strategy.id); // tokens may have been refreshed
    } catch (e) {
      this.store.clear();
      this.reset();
      throw new NotAuthenticatedError(`restore failed: ${e instanceof Error ? e.message : e}`);
    }

    const alive = await this.getClient().verifySession();
    if (!alive) {
      this.store.clear();
      this.reset();
      throw new NotAuthenticatedError("session expired");
    }

    this.established = true;
    return this.getClient();
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
    const client = await this.ensureSession();
    const strategy = this.activeStrategy;
    if (!strategy?.focusChild) {
      throw new Error(`Auth strategy "${strategy?.id}" cannot switch child.`);
    }
    childOf(this.guardian(), studentId); // validate before any side effect
    if (strategy.context?.childInFocus !== studentId) {
      await strategy.focusChild(client, studentId);
      this.persist(strategy.id);
    }
    return this.guardian();
  }

  private activeStrategy: AuthStrategy | null = null;

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
