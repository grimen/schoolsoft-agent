/**
 * Public surface of the core. Adapters (src/mcp, src/cli, future src/http)
 * import ONLY from this module — enforced by scripts/check-boundaries.ts.
 */
export {
  type Config,
  type ConfigSource,
  ENV,
  NotConfiguredError,
  envSource,
  defaultConfigDir,
  resolveConfig,
} from "./config.js";
export {
  type SessionDeps,
  createSessionManager,
  createPortal,
  createApiPortal,
  createBrowserSession,
  resolveProvider,
  getProvider,
  providerIds,
  type PortalDeps,
} from "./wiring.js";
export {
  AgentError,
  NetworkError,
  UpstreamError,
  InputError,
  EXIT_CODE_BY_KIND,
  describeError,
  detectLang,
  guardNetwork,
  MESSAGES,
  HINTS,
} from "./errors/index.js";
export type {
  ErrorKind,
  ErrorDescription,
  Lang,
  Surface,
  MessageKey,
  HintKey,
} from "./errors/index.js";
export { withSessionRecovery, isRecoverable } from "./portal/recovering.js";
export { ChildNotFoundError, ChildHasNoSchoolError } from "./portal/guardian.js";
export { CHARACTER_LIMIT, SCHOOLSOFT_USER_TYPES, type SchoolsoftUserType } from "./constants.js";
export { DEFAULT_CALLBACK_PORT, awaitCallbackCode } from "./auth/callback-server.js";
export { defaultOpenInBrowser, openerCommand } from "./auth/open-browser.js";
export type {
  SchoolProvider,
  ProviderSession,
  AuthDeps,
  BrowserAuthorization,
  ApiPortalContext,
  BrowserPortalContext,
  WebLoginSpec,
} from "./provider/types.js";
export { SessionManager, NotAuthenticatedError } from "./session/session-manager.js";
export type { PersistedSession, SessionStore } from "./session/store.js";
export { MemorySessionStore } from "./session/store.js";
export {
  MemoryPendingLoginStore,
  FilePendingLoginStore,
  PENDING_LOGIN_TTL_MS,
} from "./session/pending-login.js";
export type { PendingLogin, PendingLoginStore } from "./session/pending-login.js";
export { FileSessionStore } from "./session/file-store.js";
export type { AuthStrategy, LoginInfo } from "./auth/strategy.js";
export { childOf, orgIdOf } from "./portal/guardian.js";
export type { GuardianContext } from "./portal/guardian.js";
export {
  CAPABILITIES,
  BROWSER_INSTALL_HINT,
  BrowserRequiredError,
  CapabilityNotSupportedError,
  PortalGatedError,
  SessionLostError,
  WebLoginRequiredError,
} from "./portal/types.js";
export type {
  Portal,
  Capability,
  CapabilityRouting,
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
  TablePage,
  TableSection,
} from "./portal/types.js";
export { createCompositePortal, providerOf } from "./portal/composite.js";
export type { ApiPortalPart, BrowserPortalPart } from "./portal/composite.js";
export { rankSchools, normalize } from "./school-directory.js";
export type { SchoolEntry, RankedSchool, SchoolDirectoryPort } from "./school-directory.js";
export { operations, getOperation } from "./operations/registry.js";
export { defineOperation, READ_ONLY } from "./operations/types.js";
export type { Operation, OperationAnnotations, OperationContext } from "./operations/types.js";
export { isoWeek } from "./operations/_shared.js";
export type { PageSpec, PageMap, PageFingerprint } from "./portal/page-spec.js";
export { verifyPages } from "./portal/verify.js";
export type { PageReport, PageStatus, VerifyOptions } from "./portal/verify.js";
export { inspectPage } from "./portal/inspect.js";
export type { PageInspection } from "./portal/inspect.js";
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
export { webLogin } from "./browser/web-login.js";
export type { WebSession, WebCookie, WebLoginOptions } from "./browser/web-login.js";
