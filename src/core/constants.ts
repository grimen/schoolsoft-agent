/** Max characters returned by any tool before truncation. */
export const CHARACTER_LIMIT = 25_000;

/**
 * SchoolSoft user types (`#/login/<userType>/…`). Kept in core because
 * Config validates them; renaming the config keys per provider is deferred
 * until a second provider exists.
 */
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
