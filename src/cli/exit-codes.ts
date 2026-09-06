/**
 * Exit codes a skill can branch on. They mirror the error kinds in
 * src/core/errors: 1 is reserved for bugs, everything else names a
 * situation with a known next step.
 */
import { EXIT_CODE_BY_KIND } from "../core/index.js";

export const EXIT = {
  OK: 0,
  ERROR: EXIT_CODE_BY_KIND.internal,
  NOT_AUTHENTICATED: EXIT_CODE_BY_KIND.not_authenticated,
  NOT_CONFIGURED: EXIT_CODE_BY_KIND.not_configured,
  NETWORK: EXIT_CODE_BY_KIND.network,
  NOT_AVAILABLE: EXIT_CODE_BY_KIND.not_available,
  INPUT: EXIT_CODE_BY_KIND.input,
  UPSTREAM: EXIT_CODE_BY_KIND.upstream,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];
