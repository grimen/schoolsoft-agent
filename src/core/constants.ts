/** Max characters returned by any tool before truncation. */
export const CHARACTER_LIMIT = 25_000;

/** SchoolSoft user types, as used in `#/login/<userType>/…` routes. */
export const SCHOOLSOFT_USER_TYPES = ["parent", "student", "teacher"] as const;
export type SchoolsoftUserType = (typeof SCHOOLSOFT_USER_TYPES)[number];

/** This project targets guardians. */
export const DEFAULT_USER_TYPE: SchoolsoftUserType = "parent";

/**
 * OAuth client id sent to SchoolSoft. SchoolSoft stamps the token's
 * user_type from the client id, not from the login route: eApp (student
 * app) → STUDENT, vApp (guardian app) → PARENT. Verified live 2026-09-06.
 */
export const DEFAULT_CLIENT_ID_BY_USER_TYPE: Record<SchoolsoftUserType, string> = {
  parent: "vApp",
  student: "eApp",
  teacher: "eApp",
};
export const DEFAULT_CLIENT_ID = DEFAULT_CLIENT_ID_BY_USER_TYPE[DEFAULT_USER_TYPE];

/** Port for the local OAuth callback server used during BankID login. */
export const DEFAULT_CALLBACK_PORT = 43117;
