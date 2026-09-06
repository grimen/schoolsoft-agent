/**
 * AuthStrategy is the Open/Closed seam for authentication, generic over
 * the provider's session object (credentials holder). One class per way
 * of getting an authenticated session; SchoolSoft's BankID-in-browser
 * strategy lives in src/providers/schoolsoft/auth. SessionManager depends
 * only on this interface; providers register strategies in their
 * SchoolProvider.createAuthStrategies.
 */
import type { PersistedSession } from "../session/store.js";
import type { GuardianContext } from "../portal/guardian.js";

export interface LoginInfo {
  name: string | null;
  schoolName: string | null;
  userType: string | null;
  /** Children on a guardian account (studentId + first name). */
  children?: { studentId: number; firstName: string }[];
}

export interface AuthStrategy<S = unknown> {
  /** Stable identifier, stored in PersistedSession.authMethod. */
  readonly id: string;

  /**
   * Perform interactive (or headless) login, leaving `session` fully
   * authenticated. May block on user interaction (never automates BankID).
   * Throws on failure/timeout.
   */
  login(session: S): Promise<LoginInfo>;

  /**
   * Restore a previously persisted session (`saved.data` is the provider's
   * own blob) onto `session`, refreshing whatever needs refreshing.
   * Throws if the saved state is unusable (caller falls back to login).
   */
  restore(session: S, saved: PersistedSession): Promise<void>;

  /**
   * Guardian context established by login()/restore(), persisted by
   * SessionManager and handed back on restore.
   */
  readonly context?: GuardianContext;

  /** Re-bind the session to another child (guardians). Part of the contract, never optional. */
  focusChild(session: S, studentId: number): Promise<void>;
}
