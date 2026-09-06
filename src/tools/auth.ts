import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sessionManager, requiredSchool } from "../services/wiring.js";
import type { SessionManager } from "../services/session-manager.js";
import { NotAuthenticatedError } from "../services/session-manager.js";
import { ok, fail, guarded } from "../services/respond.js";

export function registerAuthTools(
  server: McpServer,
  getManager: () => SessionManager = sessionManager,
): void {
  server.registerTool(
    "schoolsoft_login",
    {
      title: "Log in to SchoolSoft",
      description: `Start an interactive SchoolSoft login in the user's own browser.

Opens the real SchoolSoft login page locally where the user authenticates
with BankID (or password/SSO). Credentials never pass through this server
or the conversation. On success, a long-lived session is stored encrypted
on the user's machine, so this tool only needs to be run when the session
has expired.

BLOCKS until the user completes login (up to 5 minutes). Tell the user a
browser tab is opening and that they should complete BankID there.

Args:
  - strategy (string, optional): auth strategy id. Defaults to
    "bankid-browser". Only pass this if a previous login attempt
    explicitly suggested an alternative.

Returns: { status, user: { name, schoolName, userType } } on success.

Use when: any other schoolsoft_* tool returned "Not authenticated".
Don't use when: a session is already active (check schoolsoft_auth_status).`,
      inputSchema: {
        strategy: z
          .string()
          .optional()
          .describe('Auth strategy id, defaults to "bankid-browser"'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    guarded(async ({ strategy }: { strategy?: string }) => {
      const info = await getManager().login(strategy);
      return ok({ status: "logged_in", user: info });
    }),
  );

  server.registerTool(
    "schoolsoft_auth_status",
    {
      title: "Check SchoolSoft session status",
      description: `Check whether an authenticated SchoolSoft session is active or restorable.

Attempts silent restore + token refresh from the encrypted local store.
Never prompts the user.

Returns: { authenticated: boolean, school, authMethod?, savedAt?, reason? }.

Use when: deciding whether schoolsoft_login is needed, or diagnosing
authentication errors from other tools.`,
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      try {
        await getManager().ensureSession();
        const { saved } = getManager().status();
        return ok({
          authenticated: true,
          school: requiredSchool(),
          authMethod: saved?.authMethod,
          savedAt: saved ? new Date(saved.savedAt).toISOString() : undefined,
        });
      } catch (e) {
        if (e instanceof NotAuthenticatedError) {
          return ok({
            authenticated: false,
            school: process.env.SCHOOLSOFT_SCHOOL ?? null,
            reason: e.message,
          });
        }
        return fail(e);
      }
    },
  );

  server.registerTool(
    "schoolsoft_logout",
    {
      title: "Log out of SchoolSoft",
      description: `Clear the locally stored SchoolSoft session and tokens.

Deletes the encrypted session blob from disk. The user will need to run
schoolsoft_login (BankID) again before other tools work.

Returns: { status: "logged_out" }.`,
      inputSchema: {},
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    guarded(async () => {
      getManager().logout();
      return ok({ status: "logged_out" });
    }),
  );
}
