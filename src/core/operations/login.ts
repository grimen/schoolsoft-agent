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

BLOCKS until the user completes login (up to 5 minutes) unless
background: true, which returns as soon as the login URL is known while
the login continues; then poll auth_status (loginInProgress) until it is
authenticated. Use background: true in hosts that time out long tool
calls. Tell the user a browser tab is opening and that they should
complete BankID there. If the browser cannot open (sandboxed host), show
the user the returned or printed login URL.

Args:
  - strategy (string, optional): auth strategy id. Defaults to
    "bankid-browser".
  - web (boolean, optional): perform the WEB login in a visible browser
    window instead. Required once before grades, student documents,
    assessment and attendance (SchoolSoft's GDPR gate); the app session
    covers everything else.
  - background (boolean, optional): start the login and return at once
    with the URL; finish by polling auth_status.

Returns: { status: "logged_in", user: { name, schoolName, userType, children } },
or with background: { status: "login_started", url, startedAt }.

Use when: any other operation reported "Not authenticated".
Don't use when: a session is already active (check auth_status).`,
  input: {
    strategy: z.string().optional().describe('Auth strategy id, defaults to "bankid-browser"'),
    web: z
      .boolean()
      .optional()
      .describe(
        "Web login instead: opens a browser window for SchoolSoft's normal login; needed once for grades, documents and attendance (GDPR-gated pages).",
      ),
    background: z
      .boolean()
      .optional()
      .describe("Return as soon as the login URL is known; poll auth_status to see it finish"),
  },
  portal: [],
  annotations: { readOnly: false, destructive: false, idempotent: false, requiresAuth: false },
  async run(ctx, { strategy, web, background }) {
    if (web) {
      const result = await ctx.manager.webLogin();
      return { status: result.status, landedOn: result.landedOn, cookies: result.cookies };
    }
    if (background) {
      const started = await ctx.manager.startLogin(strategy);
      return {
        status: "login_started" as const,
        url: started.url,
        startedAt: new Date(started.startedAt).toISOString(),
        next: "Ask the user to complete BankID in the browser, then call auth_status until authenticated is true.",
      };
    }
    const user = await ctx.manager.login(strategy);
    return { status: "logged_in" as const, user };
  },
});
