/**
 * Production wiring — the only place that knows about concrete
 * implementations and environment variables. Tests never import this;
 * they construct SessionManager directly with fakes.
 */
import { FileSessionStore } from "./file-store.js";
import { SessionManager } from "./session-manager.js";
import { GuardianApi } from "../api/guardian.js";
import { BankIdBrowserStrategy } from "../auth/bankid-browser.js";
import {
  SCHOOL_ENV,
  ORGID_ENV,
  DEFAULT_STATE_DIR_ENV,
  USER_TYPE_ENV,
  DEFAULT_USER_TYPE,
  CLIENT_ID_ENV,
  DEFAULT_CLIENT_ID_BY_USER_TYPE,
  SCHOOLSOFT_USER_TYPES,
  type SchoolsoftUserType,
} from "../constants.js";

export function requiredSchool(): string {
  const school = process.env[SCHOOL_ENV];
  if (!school) {
    throw new Error(
      `Missing ${SCHOOL_ENV} environment variable. Set it to the school ` +
        `slug from your SchoolSoft URL, e.g. "taby" for ` +
        `https://sms.schoolsoft.se/taby/...`,
    );
  }
  return school;
}

export function userTypeFromEnv(): SchoolsoftUserType {
  const raw = process.env[USER_TYPE_ENV];
  if (raw === undefined || raw === "") return DEFAULT_USER_TYPE;
  if ((SCHOOLSOFT_USER_TYPES as readonly string[]).includes(raw)) {
    return raw as SchoolsoftUserType;
  }
  throw new Error(
    `Invalid ${USER_TYPE_ENV}="${raw}". Expected one of: ` +
      SCHOOLSOFT_USER_TYPES.join(", "),
  );
}

let manager: SessionManager | null = null;

/** Guardian data API bound to the live session of a SessionManager. */
export function guardianApi(m: SessionManager): GuardianApi {
  const client = m.getClient();
  return new GuardianApi({
    school: client.school,
    accessToken: () => client.accessToken,
    cookieHeader: () => {
      try {
        return client.cookieHeader;
      } catch {
        return null;
      }
    },
  });
}

/** Lazily built process-wide SessionManager (one user per stdio server). */
export function sessionManager(): SessionManager {
  if (!manager) {
    manager = new SessionManager({
      school: requiredSchool(),
      store: FileSessionStore.fromEnv(DEFAULT_STATE_DIR_ENV),
      strategies: [
        new BankIdBrowserStrategy({
          orgid: process.env[ORGID_ENV],
          userType: userTypeFromEnv(),
          clientId:
            process.env[CLIENT_ID_ENV] ||
            DEFAULT_CLIENT_ID_BY_USER_TYPE[userTypeFromEnv()],
        }),
      ],
    });
  }
  return manager;
}
