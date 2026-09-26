/**
 * `make capture`: record the structures the offline work guessed at
 * (absence, leave and message form structure; the GDPR-gated Översikt
 * page; a school-event agenda) from an EXISTING session, redacted, into a
 * gitignored directory (.captures/, or SCHOOLSOFT_CAPTURE_DIR). Local and
 * live only: it never logs in, never submits a form and never calls a write
 * endpoint. The maintainer reviews every file, then `make capture-promote`.
 * The flow itself is src/providers/schoolsoft/capture/capture.ts (tested
 * offline); this file only wires the real session, browser and HTTP.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { loadContext } from "../src/shared/bootstrap.js";
import {
  createApiPortal,
  createBrowserSession,
  detectLang,
  requestBudgetOf,
} from "../src/core/index.js";
import { stockholmToday } from "../src/core/operations/_calendar-range.js";
import { SchoolsoftHttp } from "../src/providers/schoolsoft/portal/api/transport.js";
import { budgetedFetch } from "../src/providers/schoolsoft/net.js";
import { captureMain } from "../src/providers/schoolsoft/capture/capture.js";

const dir = resolve(process.env.SCHOOLSOFT_CAPTURE_DIR ?? ".captures");

const code = await captureMain(
  () => {
    const ctx = loadContext({ env: process.env, home: homedir(), platform: process.platform })();
    const m = ctx.manager;
    return {
      ensureSession: () => m.ensureSession(),
      knownNames: () => {
        const g = m.guardian();
        return [
          g.parentName,
          ctx.config.school,
          ...g.children.flatMap((c) => [c.firstName, c.lastName, ...c.schools.map((s) => s.name)]),
        ];
      },
      hasWebSession: () => m.getWebSession() !== null,
      syncWebChild: () => createApiPortal(m).syncWebChild(),
      openBrowser: () => createBrowserSession(m, { engine: ctx.config.browser }),
      getJson: (path) =>
        // Through the session's request budget, like every other request to the portal.
        new SchoolsoftHttp(ctx.config.school, budgetedFetch(requestBudgetOf(m))).get(path, {
          Cookie: m.getSession().cookieHeader() ?? "",
        }),
      today: () => stockholmToday(),
      salt: () => randomBytes(16).toString("hex"),
      write: (file, content) => {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        writeFileSync(join(dir, file), content, { mode: 0o600 });
      },
    };
  },
  { out: (l) => console.log(l), err: (l) => console.error(l) },
  dir,
  detectLang(process.env),
);
process.exit(code);
