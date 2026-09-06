/** Max characters returned by any tool before truncation. */
export const CHARACTER_LIMIT = 25_000;

/** Where encrypted session state is persisted (overridable via env). */
export const DEFAULT_STATE_DIR_ENV = "SCHOOLSOFT_STATE_DIR";

/** School slug, e.g. "taby" from https://sms.schoolsoft.se/taby/... */
export const SCHOOL_ENV = "SCHOOLSOFT_SCHOOL";

/** Optional org id (defaults to ssp-node's default). */
export const ORGID_ENV = "SCHOOLSOFT_ORGID";

/** Port for the local OAuth callback server used during BankID login. */
export const CALLBACK_PORT_ENV = "SCHOOLSOFT_CALLBACK_PORT";
export const DEFAULT_CALLBACK_PORT = 43117;
