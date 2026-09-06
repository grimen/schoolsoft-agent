/** Exit codes a skill can branch on. */
export const EXIT = {
  OK: 0,
  ERROR: 1,
  NOT_AUTHENTICATED: 2,
  NOT_CONFIGURED: 3,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];
