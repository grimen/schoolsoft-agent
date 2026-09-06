/**
 * Mid-conversation session loss is the most common dead end: a token or
 * cookie dies between two calls and SchoolSoft answers 401. Instead of
 * surfacing that, re-establish the session once (refresh + cookie
 * exchange, no user interaction) and repeat the call. A second rejection
 * means the saved session is really gone, and the user is told to log in.
 * Web-session losses are not retried here: only the user can fix those.
 */
import { AgentError } from "../errors/index.js";
import { UpstreamError } from "../errors/index.js";
import { CAPABILITIES, SessionLostError, type Capability, type Portal } from "./types.js";

export function isRecoverable(e: unknown): boolean {
  if (e instanceof UpstreamError) return e.sessionRejected;
  if (e instanceof SessionLostError) return !e.web;
  return false;
}

export interface RecoveryOptions {
  /** Re-establish the app session silently; throws NotAuthenticatedError when impossible. */
  recover: () => Promise<unknown>;
  /** Wrap the second failure (default: not_authenticated / session_rejected_twice). */
  onSecondFailure?: (e: unknown) => Error;
}

export function withSessionRecovery(portal: Portal, o: RecoveryOptions): Portal {
  const out: Partial<Record<Capability, (...args: unknown[]) => Promise<unknown>>> = {};
  for (const capability of CAPABILITIES) {
    out[capability] = async (...args: unknown[]) => {
      const fn = (portal as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[
        capability
      ];
      try {
        return await fn.apply(portal, args);
      } catch (e) {
        if (!isRecoverable(e)) throw e;
        await o.recover();
        try {
          return await fn.apply(portal, args);
        } catch (again) {
          if (!isRecoverable(again)) throw again;
          throw (
            o.onSecondFailure?.(again) ??
            new AgentError({
              kind: "not_authenticated",
              key: "session_rejected_twice",
              hint: "login",
              cause: again,
            })
          );
        }
      }
    };
  }
  return out as unknown as Portal;
}
