import { defineOperation } from "./types.js";
import { NotAuthenticatedError } from "../session/session-manager.js";

export const authStatus = defineOperation({
  name: "auth_status",
  title: "Check SchoolSoft session status",
  description: `Check whether an authenticated SchoolSoft session is active or restorable.

Attempts silent restore + token refresh from the encrypted local store.
Never prompts the user.

Returns: { authenticated: boolean, school, authMethod?, savedAt?, childInFocus?, children?, reason? }.

Use when: deciding whether login is needed, or diagnosing authentication
errors from other operations.`,
  input: {},
  portal: [],
  annotations: { readOnly: true, destructive: false, idempotent: true, requiresAuth: false },
  async run(ctx) {
    try {
      await ctx.manager.ensureSession();
      const { saved } = ctx.manager.status();
      return {
        authenticated: true as const,
        school: ctx.config.school,
        authMethod: saved?.authMethod,
        savedAt: saved ? new Date(saved.savedAt).toISOString() : undefined,
        childInFocus: saved?.guardian?.childInFocus,
        webSession: saved?.web
          ? {
              savedAt: new Date(saved.web.savedAt).toISOString(),
              cookies: saved.web.cookies.length,
            }
          : null,
        children: saved?.guardian?.children.map((c) => ({
          studentId: c.studentId,
          firstName: c.firstName,
        })),
      };
    } catch (e) {
      if (e instanceof NotAuthenticatedError) {
        return { authenticated: false as const, school: ctx.config.school, reason: e.message };
      }
      throw e;
    }
  },
});
