/**
 * SchoolSoft's interactive login for BankID: build SchoolSoft's OAuth2+PKCE
 * auth URL with a localhost callback as redirect_uri, hand it to core's
 * callback server (which opens the browser and waits), then return the
 * code + verifier for the token exchange. The user authenticates however
 * they like on the real SchoolSoft login page; we never see credentials.
 *
 * Verified live 2026-09-06: SchoolSoft accepts the localhost redirect_uri.
 */
import { awaitCallbackCode, DEFAULT_CALLBACK_PORT } from "../../../core/auth/callback-server.js";
import {
  DEFAULT_USER_TYPE,
  DEFAULT_CLIENT_ID,
  type SchoolsoftUserType,
} from "../../../core/constants.js";
import { buildAuthUrl } from "./oauth.js";

export interface BrowserFlowResult {
  code: string;
  verifier: string;
}

/**
 * Runs the full interactive flow. Resolves with the authorization code
 * once the user has completed login (e.g. via BankID), or rejects on
 * timeout / state mismatch.
 */
export async function runBrowserLogin(options: {
  school: string;
  orgid?: string;
  /**
   * SchoolSoft login route: "parent" | "student" | "teacher". Every login
   * page (password, SAML, BankID) lives under `#/login/<userType>/…` and
   * the backend resolves the authenticated identity *as that user type*.
   * ssp-node hardcodes "student"; guardians must use "parent" or they get
   * "Användaren … är inte aktiv på den här skolan" after a successful
   * BankID. Defaults to "parent".
   */
  userType?: SchoolsoftUserType;
  /** OAuth client id; see CLIENT_ID_ENV in constants.ts. Defaults to eApp. */
  clientId?: string;
  /** Local callback port. Defaults to DEFAULT_CALLBACK_PORT. */
  port?: number;
  timeoutMs?: number;
  /** Injectable for tests; defaults to opening the OS default browser. */
  openBrowser?: (url: string) => void;
}): Promise<{ result: BrowserFlowResult; authUrl: string }> {
  const port = options.port ?? DEFAULT_CALLBACK_PORT;
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  const flow = buildAuthUrl({
    school: options.school,
    userType: options.userType ?? DEFAULT_USER_TYPE,
    clientId: options.clientId ?? DEFAULT_CLIENT_ID,
    redirectUri,
    orgid: options.orgid,
  });

  const code = await awaitCallbackCode({
    authUrl: flow.authUrl,
    expectedState: flow.state,
    port,
    timeoutMs: options.timeoutMs,
    openBrowser: options.openBrowser,
  });

  return {
    result: { code, verifier: flow.verifier },
    authUrl: flow.authUrl,
  };
}
