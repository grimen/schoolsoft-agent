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
  createPortal,
  type PortalDeps,
} from "./config.js";
export { CHARACTER_LIMIT, SCHOOLSOFT_USER_TYPES, type SchoolsoftUserType } from "./constants.js";
export { SessionManager, NotAuthenticatedError } from "./session/session-manager.js";
export type { PersistedSession, SessionStore } from "./session/store.js";
export { MemorySessionStore } from "./session/store.js";
export { FileSessionStore } from "./session/file-store.js";
export type { AuthStrategy, LoginInfo } from "./auth/strategy.js";
export { ApiPortal, GuardianApi, childOf, orgIdOf } from "./portal/api-portal.js";
export type { GuardianApiOptions, GuardianContext, ApiFetch } from "./portal/api-portal.js";
export {
  PROVIDERS,
  API_CAPABILITIES,
  BROWSER_CAPABILITIES,
  BROWSER_INSTALL_HINT,
  BrowserRequiredError,
  PortalGatedError,
  SessionLostError,
} from "./portal/types.js";
export type {
  Portal,
  Capability,
  PortalProvider,
  GuardianChild,
  GuardianParent,
  GuardianChildSchool,
  ContactGroup,
  ContactPerson,
  SubjectRoom,
  ActivityEntry,
  Booking,
  PortalFile,
} from "./portal/types.js";
export { createCompositePortal, providerOf } from "./portal/composite.js";
export type { ApiPortalPart, BrowserPortalPart } from "./portal/composite.js";
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
export { BrowserPortal, PAGES as BROWSER_PAGES } from "./portal/browser-portal.js";
export { PlaywrightSession } from "./browser/playwright.js";
export type { PlaywrightLike, PlaywrightLoader } from "./browser/playwright.js";
export { browserStatus, installChromium } from "./browser/install.js";
export type { BrowserStatus, StatusProbes, Spawner } from "./browser/install.js";
export type {
  BrowserSession,
  PortalPage,
  BrowserEngine,
  WithPageOptions,
} from "./browser/session.js";
