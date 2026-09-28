/**
 * Other families' data has one boundary (docs/planning/specs/2026-09-28-other-families-data.md):
 * every portal `createPortals` hands out, cached or fresh, is redacted, and no
 * surface can reach the three capabilities any other way. Synthetic data only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  MemorySessionHistoryStore,
  MemorySessionStore,
  createPortals,
  createSessionManager,
  resolveConfig,
  type ContactGroup,
  type PortalDeps,
} from "../../src/core/index.js";
import type { BrowserPortalPart } from "../../src/core/portal/composite.js";
import { SchoolsoftSim, savedSession } from "../helpers/schoolsoft-sim.js";

const CLASS_LIST: ContactGroup[] = [
  { title: "Elever", people: [{ name: "Anna Exempel", role: "", email: "anna@example.test" }] },
  {
    title: "Personal",
    people: [{ name: "Lärare Exempel", role: "Mentor", email: "larare@skola.example" }],
  },
];

function wired(deps: Partial<PortalDeps> = {}) {
  const now = 1_900_000_000_000;
  const sim = new SchoolsoftSim(() => now);
  const store = new MemorySessionStore();
  store.save(savedSession(now));
  const config = resolveConfig([{ school: "taby", configDir: "/nowhere" }], {
    home: "/unused",
    platform: "linux",
  });
  const manager = createSessionManager(config, {
    store,
    history: new MemorySessionHistoryStore(),
    now: () => now,
    fetchImpl: sim.fetch,
  });
  let contactReads = 0;
  const browser = {
    getContacts: async () => {
      contactReads++;
      return structuredClone(CLASS_LIST);
    },
  } as unknown as BrowserPortalPart;
  sim.override = (pathname) => {
    if (/\/messages\/\d+$/.test(pathname))
      return {
        id: 5,
        subject: "Utflykt",
        message: "Ta med matsäck.",
        recipients: [{ firstName: "Doris", lastName: "Exempel", email: "doris@example.test" }],
      };
    if (pathname.endsWith("/rest/blogpost/getbyloggedinuser"))
      return [
        {
          blogPost: { id: 1, creDate: 0, name: "Utflykt", description: "Skogen" },
          recipientsNamesString: "Klass 4B",
          numberOfComments: 2,
        },
      ];
    return undefined;
  };
  const portals = createPortals(manager, { fetchImpl: sim.fetch, browser, ...deps });
  return { manager, portals, sim, contactReads: () => contactReads };
}

test("every portal createPortals hands out redacts, and never caches, other families' data", async () => {
  const w = wired();
  await w.manager.ensureSession();
  for (const portal of [w.portals.portal, w.portals.freshPortal]) {
    const [pupils, staff] = await portal.getContacts();
    assert.deepEqual(pupils, {
      title: "Elever",
      detailsHidden: true,
      people: [{ name: "Anna Exempel", role: "" }],
    });
    assert.deepEqual(staff, CLASS_LIST[1]);
    assert.deepEqual(await portal.getMessage(21, 20, 5), {
      id: 5,
      subject: "Utflykt",
      message: "Ta med matsäck.",
      recipients: ["Doris Exempel"],
    });
    assert.deepEqual(await portal.getActivityLog(3), [
      {
        id: 1,
        date: new Date(0).toISOString(),
        title: "Utflykt",
        text: "Skogen",
        recipients: "Klass 4B",
        comments: 2,
      },
    ]);
  }
  // Two rounds, and every read went upstream: nothing was answered from the read cache.
  await w.portals.portal.getContacts();
  await w.portals.portal.getActivityLog(3);
  assert.equal(w.contactReads(), 3);
  assert.equal(w.sim.requests.filter((r) => r.endsWith("/getbyloggedinuser")).length, 3);
});

test("the opt-in reveals other families' contact details, and nothing else", async () => {
  const w = wired({ contactDetails: true });
  await w.manager.ensureSession();
  assert.deepEqual(await w.portals.portal.getContacts(), CLASS_LIST);
  assert.deepEqual((await w.portals.freshPortal.getMessage(21, 20, 5)) as object, {
    id: 5,
    subject: "Utflykt",
    message: "Ta med matsäck.",
    recipients: ["Doris Exempel"],
  });
});

/** The argument list of each call to `name` in `text`, parentheses balanced. */
function calls(text: string, name: string): string[] {
  const out: string[] = [];
  for (let at = text.indexOf(name + "("); at !== -1; at = text.indexOf(name + "(", at + 1)) {
    let depth = 0;
    let end = at + name.length;
    do {
      if (text[end] === "(") depth++;
      else if (text[end] === ")") depth--;
      end++;
    } while (depth > 0 && end < text.length);
    out.push(text.slice(at, end));
  }
  return out;
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : path.endsWith(".ts") ? [path] : [];
  });
}

test("no surface can bypass the redaction", () => {
  const root = process.cwd();
  const adapters = ["src/cli", "src/mcp", "src/http", "src/shared"].flatMap((dir) =>
    sources(join(root, dir)),
  );
  const portalCalls: string[] = [];
  for (const file of adapters) {
    const name = relative(root, file);
    const text = readFileSync(file, "utf8");
    // Building a portal by hand would skip createPortals and so the redaction.
    assert.doesNotMatch(text, /createCompositePortal|withReadCache|createBrowserPortal/, name);
    // The bare API portal serves messages and the activity log unredacted: only its
    // child-in-focus sync may be used.
    for (const call of text.matchAll(/createApiPortal\([^)]*\)(\.\w+)?/g))
      assert.equal(call[1], ".syncWebChild", `${name}: ${call[0]}`);
    // Each surface says which setting decides the reveal (off when it forgets).
    for (const call of calls(text, "createPortals")) {
      portalCalls.push(name);
      assert.match(call, /contactDetails:/, `${name} passes contactDetails to createPortals`);
    }
  }
  // The two production surfaces: local (CLI and MCP) and the connector (MCP and REST).
  assert.deepEqual(portalCalls.sort(), ["src/http/runtime.ts", "src/shared/bootstrap.ts"]);
});
