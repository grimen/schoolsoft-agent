/**
 * verifyPages against a fake session: anchors decide broken, recorded
 * fingerprints decide drift, gated pages skip without a web session, an
 * example query is resolved for pages that need one, errors are reported
 * per page and never abort the run.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyPages } from "../../src/core/portal/verify.js";
import { PAGES, PAGE_KEYS } from "../../src/core/portal/pages.js";
import type {
  BrowserSession,
  PortalPage,
  WithPageOptions,
} from "../../src/core/browser/session.js";

function fakeSession(inspect: (path: string, anchors: string[]) => unknown, failOn?: string) {
  const visits: { path: string; web?: boolean }[] = [];
  let current = "";
  let opts: WithPageOptions = {};
  const page: PortalPage = {
    goto: async (path) => {
      if (failOn && path.startsWith(failOn)) throw new Error("boom " + path);
      current = path;
      visits.push({ path, web: opts.web });
    },
    url: () => "https://sms.schoolsoft.se/taby" + current,
    evaluate: async <T, A>(fn: (arg: A) => T, arg?: A) =>
      (fn.name === "extractSubjectLinks"
        ? [{ subject: "Bild", url: "x", subjectId: 1301 }]
        : inspect(current, arg as unknown as string[])) as T,
    waitForJson: async () => ({}) as never,
  };
  const session: BrowserSession = {
    withPage: async (fn, o = {}) => {
      opts = o;
      return fn(page);
    },
    close: async () => {},
  };
  return { session, visits };
}

const healthy = (fp: string) => (_path: string, anchors: string[]) => ({
  title: "Sida",
  anchors: Object.fromEntries(anchors.map((a) => [a, 1])),
  fingerprint: fp,
  nodes: 10,
});

test("all anchors present and no recorded fingerprint → ok; gated pages skipped without a web session", async () => {
  const { session, visits } = fakeSession(healthy("abcd1234"));
  const reports = await verifyPages(session, { hasWebSession: false, fingerprints: {} });
  assert.equal(reports.length, PAGE_KEYS.length);
  for (const r of reports) {
    assert.equal(r.status, PAGES[r.page].web ? "skipped" : "ok", r.page);
  }
  assert.ok(
    visits.every((v) => v.web === false),
    "only app-session pages visited",
  );
});

test("with a web session every page is visited with its cookies; criteria gets an example query from the subject menu", async () => {
  const { session, visits } = fakeSession(healthy("abcd1234"));
  const reports = await verifyPages(session, { hasWebSession: true, fingerprints: {} });
  assert.ok(
    reports.every((r) => r.status === "ok"),
    JSON.stringify(reports),
  );
  const criteria = visits.filter((v) => v.path.startsWith(PAGES.assessmentCriteria.path));
  assert.deepEqual(criteria, [
    { path: PAGES.assessmentCriteria.path + "?subject=1301&schooltype=7", web: true },
  ]);
  const menuVisits = visits.filter((v) => v.path === PAGES.subjects.path);
  assert.deepEqual(
    menuVisits.map((v) => v.web),
    [false, false],
    "menu verified once and read once for the example, both under the app session",
  );
});

test("missing anchors → broken; changed fingerprint → drift; a page error is reported, not thrown", async () => {
  const { session } = fakeSession(
    (path, anchors) => ({
      title: "Sida",
      anchors: Object.fromEntries(
        anchors.map((a) => [a, path === PAGES.contacts.path && a === "#contAll_content" ? 0 : 1]),
      ),
      fingerprint: "ffffffff",
      nodes: 1,
    }),
    PAGES.files.path,
  );
  const reports = await verifyPages(session, {
    hasWebSession: false,
    pages: ["contacts", "bookings", "files"],
    fingerprints: { bookings: { fingerprint: "00000000" }, contacts: { fingerprint: "ffffffff" } },
  });
  const by = Object.fromEntries(reports.map((r) => [r.page, r]));
  assert.equal(by.contacts.status, "broken");
  assert.deepEqual(by.contacts.missing, ["#contAll_content"]);
  assert.equal(by.bookings.status, "drift");
  assert.equal(by.bookings.expected, "00000000");
  assert.equal(by.files.status, "error");
  assert.match(by.files.reason ?? "", /boom/);
});

test("without a sync hook gated pages still verify; an inspection lacking an anchor key counts as missing", async () => {
  const { session } = fakeSession((_path, anchors) => ({
    title: "T",
    anchors: Object.fromEntries(anchors.slice(1).map((a) => [a, 1])),
    fingerprint: "0",
    nodes: 1,
  }));
  const reports = await verifyPages(session, {
    hasWebSession: true,
    pages: ["grades", "contacts"],
    fingerprints: {},
  });
  assert.deepEqual(
    reports.map((r) => [r.page, r.status, r.missing]),
    [
      ["grades", "broken", ["#content .h1"]],
      ["contacts", "broken", ["#content .h1"]],
    ],
  );
});
