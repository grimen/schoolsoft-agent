/**
 * Production wiring — the only place that knows about concrete
 * implementations and environment variables. Tests never import this;
 * they construct SessionManager directly with fakes.
 */
import { FileSessionStore } from "./file-store.js";
import { SessionManager } from "./session-manager.js";
import { BankIdBrowserStrategy } from "../auth/bankid-browser.js";
import { SCHOOL_ENV, ORGID_ENV, DEFAULT_STATE_DIR_ENV } from "../constants.js";

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

let manager: SessionManager | null = null;

/** Lazily built process-wide SessionManager (one user per stdio server). */
export function sessionManager(): SessionManager {
  if (!manager) {
    manager = new SessionManager({
      school: requiredSchool(),
      store: FileSessionStore.fromEnv(DEFAULT_STATE_DIR_ENV),
      strategies: [
        new BankIdBrowserStrategy({ orgid: process.env[ORGID_ENV] }),
      ],
    });
  }
  return manager;
}
