import { defineOperation } from "./types.js";

export const logout = defineOperation({
  name: "logout",
  title: "Log out of SchoolSoft",
  description: `Clear the locally stored SchoolSoft session and tokens.

Deletes the encrypted session blob from disk. The user will need to log in
(BankID) again before other operations work.

Returns: { status: "logged_out" }.

Use when: the user asks to log out or to remove stored SchoolSoft data.`,
  input: {},
  portal: [],
  annotations: { readOnly: false, destructive: true, idempotent: true, requiresAuth: false },
  async run(ctx) {
    ctx.manager.logout();
    return { status: "logged_out" as const };
  },
});
