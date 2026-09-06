/**
 * Public surface of the core. Adapters (src/mcp, src/cli, future src/http)
 * import ONLY from this module — enforced by scripts/check-boundaries.ts.
 */
export {
  type Config,
  type ConfigSource,
  type SessionDeps,
  ENV,
  NotConfiguredError,
  envSource,
  defaultConfigDir,
  resolveConfig,
  createSessionManager,
  createGuardianApi,
} from "./config.js";
export { CHARACTER_LIMIT, SCHOOLSOFT_USER_TYPES, type SchoolsoftUserType } from "./constants.js";
export { SessionManager, NotAuthenticatedError } from "./session/session-manager.js";
export type { PersistedSession, SessionStore } from "./session/store.js";
export { MemorySessionStore } from "./session/store.js";
export { FileSessionStore } from "./session/file-store.js";
export type { AuthStrategy, LoginInfo } from "./auth/strategy.js";
export { GuardianApi, childOf, orgIdOf } from "./api/guardian.js";
export type {
  GuardianApiOptions,
  GuardianContext,
  GuardianChild,
  GuardianParent,
} from "./api/guardian.js";
export {
  SchoolDirectory,
  rankSchools,
  normalize,
  parseSchoolList,
  SCHOOL_LIST_URL,
} from "./api/schools.js";
export type { SchoolEntry, RankedSchool } from "./api/schools.js";
export { decodeJwtClaims } from "./auth/oauth.js";
export { operations, getOperation } from "./operations/registry.js";
export { defineOperation, READ_ONLY } from "./operations/types.js";
export type { Operation, OperationAnnotations, OperationContext } from "./operations/types.js";
export { isoWeek } from "./operations/_shared.js";
