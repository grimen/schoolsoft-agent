/**
 * Watches the capabilities that ride on the web-login session: a successful
 * read is reported as a use, a web SessionLostError as a loss. The loss is
 * rethrown saying how long the session had been idle, when that is known,
 * so the user learns what the portal's timeout looks like.
 */
import { CAPABILITIES, SessionLostError, type Capability, type Portal } from "./types.js";

export interface WebSessionObserverOptions {
  /** Capabilities that need the web-login session (SchoolProvider.webSessionCapabilities). */
  capabilities: readonly Capability[];
  onUse: () => void;
  /** Records the loss; returns how long the session had been idle (ms), null when unknown. */
  onLost: () => number | null;
}

/** The same loss, with the observed idle time when there is one. */
export function withIdleTime(e: SessionLostError, idleMs: number | null): SessionLostError {
  return idleMs === null
    ? e
    : new SessionLostError(e.params.page, true, Math.round(idleMs / 60_000));
}

export function withWebSessionObserver(portal: Portal, o: WebSessionObserverOptions): Portal {
  const out: Partial<Record<Capability, (...args: unknown[]) => Promise<unknown>>> = {};
  for (const capability of CAPABILITIES) {
    const fn = (portal as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[
      capability
    ];
    out[capability] = !o.capabilities.includes(capability)
      ? (...args: unknown[]) => fn.apply(portal, args)
      : async (...args: unknown[]) => {
          try {
            const value = await fn.apply(portal, args);
            o.onUse();
            return value;
          } catch (e) {
            if (e instanceof SessionLostError && e.web) throw withIdleTime(e, o.onLost());
            throw e;
          }
        };
  }
  return out as unknown as Portal;
}
