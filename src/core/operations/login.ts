import { z } from "zod";
import { defineOperation } from "./types.js";

export const login = defineOperation({
  name: "login",
  title: "Log in to SchoolSoft",
  description: `Start an interactive SchoolSoft login in the user's own browser.

Opens the real SchoolSoft login page locally where the user authenticates
with BankID (or password/SSO). Credentials never pass through this
integration or the conversation. On success a session is stored encrypted
on the user's machine and refreshed silently, so this is only needed when
no session exists or it has expired.

BLOCKS until the user completes login (up to 5 minutes). Tell the user a
browser tab is opening and that they should complete BankID there. If the
browser cannot open (sandboxed host), show the user the login URL printed
in the diagnostics.

Args:
  - strategy (string, optional): auth strategy id. Defaults to
    "bankid-browser".

Returns: { status: "logged_in", user: { name, schoolName, userType, children } }.

Use when: any other operation reported "Not authenticated".
Don't use when: a session is already active (check auth_status).`,
  input: {
    strategy: z.string().optional().describe('Auth strategy id, defaults to "bankid-browser"'),
  },
  annotations: { readOnly: false, destructive: false, idempotent: false, requiresAuth: false },
  async run(ctx, { strategy }) {
    const user = await ctx.manager.login(strategy);
    return { status: "logged_in" as const, user };
  },
});
