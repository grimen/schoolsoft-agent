/**
 * AuthStrategy is the Open/Closed seam for authentication.
 *
 * Each way of getting an authenticated SchoolsoftClient is one class:
 *   - BankIdBrowserStrategy (implemented): OAuth2+PKCE in the user's own
 *     browser; user completes BankID there.
 *   - PlaywrightInterceptStrategy (planned fallback): headed browser via
 *     Playwright, intercept the app deep-link redirect.
 *   - PasswordStrategy (planned fallback): headless mobileLogin with
 *     username/password after a one-time BankID bootstrap.
 *
 * SessionManager depends only on this interface. Adding a strategy never
 * modifies existing code — register it in the wiring (client.ts).
 */
import type { SchoolsoftClient } from "@elias4044/ssp-node";
import type { PersistedSession } from "../session/store.js";
import type { GuardianContext } from "../api/guardian.js";

export interface LoginInfo {
  name: string | null;
  schoolName: string | null;
  userType: string | null;
  /** Children on a guardian account (studentId + first name). */
  children?: { studentId: number; firstName: string }[];
}

export interface AuthStrategy {
  /** Stable identifier, stored in PersistedSession.authMethod. */
  readonly id: string;

  /**
   * Perform interactive (or headless) login, leaving `client` fully
   * authenticated (session cookies established). May block on user
   * interaction. Throws on failure/timeout.
   */
  login(client: SchoolsoftClient): Promise<LoginInfo>;

  /**
   * Restore a previously persisted session onto `client`, refreshing
   * whatever needs refreshing, leaving it fully authenticated.
   * Throws if the saved state is unusable (caller falls back to login).
   */
  restore(client: SchoolsoftClient, saved: PersistedSession): Promise<void>;

  /**
   * Guardian context established by login()/restore(), persisted by
   * SessionManager and handed back on restore. Undefined for strategies
   * that don't model guardians.
   */
  readonly context?: GuardianContext;

  /**
   * Re-bind the cookie session to another child (guardians). Optional;
   * SessionManager reports "not supported" if absent.
   */
  focusChild?(client: SchoolsoftClient, studentId: number): Promise<void>;
}
