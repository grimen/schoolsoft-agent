/** Max characters returned by any tool before truncation. */
export const CHARACTER_LIMIT = 25_000;

/** Where encrypted session state is persisted (overridable via env). */
export const DEFAULT_STATE_DIR_ENV = "SCHOOLSOFT_STATE_DIR";

/** School slug, e.g. "taby" from https://sms.schoolsoft.se/taby/... */
export const SCHOOL_ENV = "SCHOOLSOFT_SCHOOL";

/** SchoolSoft user types, as used in `#/login/<userType>/…` routes. */
export const SCHOOLSOFT_USER_TYPES = ["parent", "student", "teacher"] as const;
export type SchoolsoftUserType = (typeof SCHOOLSOFT_USER_TYPES)[number];

/** Which login route to use. This server targets guardians. */
export const USER_TYPE_ENV = "SCHOOLSOFT_USER_TYPE";
export const DEFAULT_USER_TYPE: SchoolsoftUserType = "parent";

/**
 * OAuth client id sent to SchoolSoft. SchoolSoft stamps the token's
 * user_type from the client id, not from the login route: eApp (student
 * app) → STUDENT, vApp (guardian app) → PARENT. Override only for
 * experiments.
 */
export const CLIENT_ID_ENV = "SCHOOLSOFT_CLIENT_ID";
/** Verified live 2026-09-06: eApp mints STUDENT tokens, vApp mints PARENT. */
export const DEFAULT_CLIENT_ID_BY_USER_TYPE: Record<SchoolsoftUserType, string> = {
  parent: "vApp",
  student: "eApp",
  teacher: "eApp",
};
export const DEFAULT_CLIENT_ID = DEFAULT_CLIENT_ID_BY_USER_TYPE[DEFAULT_USER_TYPE];

/** Optional org id (defaults to ssp-node's default). */
export const ORGID_ENV = "SCHOOLSOFT_ORGID";

/** Port for the local OAuth callback server used during BankID login. */
export const CALLBACK_PORT_ENV = "SCHOOLSOFT_CALLBACK_PORT";
export const DEFAULT_CALLBACK_PORT = 43117;
