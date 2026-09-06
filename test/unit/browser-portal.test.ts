/**
 * BrowserPortal orchestration with a fake session: which pages it visits,
 * that extractors run in-page, which cookies a visit asks for, the web-child
 * sync before gated pages, and subject-name resolution for criteria. The
 * extractors themselves run against fixtures in real Chromium in
 * test/e2e-hosts/extractors.e2e.test.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { BrowserPortal, PAGES, normalizeSubject } from "../../src/core/portal/browser-portal.js";
import { PAGE_KEYS } from "../../src/core/portal/pages.js";
import type {
  BrowserSession,
  PortalPage,
  WithPageOptions,
} from "../../src/core/browser/session.js";
import { WebLoginRequiredError } from "../../src/core/portal/types.js";

function fakeSession(evaluateResults: Record<string, unknown>) {
  const visited: string[] = [];
  const options: WithPageOptions[] = [];
  let current = "";
  const page: PortalPage = {
    goto: async (path) => {
      visited.push(path);
      current = path;
    },
    url: () => "https://sms.schoolsoft.se/taby" + current,
    evaluate: async <T, A>(fn: (arg: A) => T) => evaluateResults[fn.name] as T,
    waitForJson: async () => ({}) as never,
  };
  const session: BrowserSession = {
    withPage: async (fn, o = {}) => {
      options.push(o);
      return fn(page);
    },
    close: async () => {},
  };
  return { session, visited, options };
}

test("every page spec has a path under the tenant and at least one anchor", () => {
  for (const key of PAGE_KEYS) {
    const spec = PAGES[key];
    assert.match(spec.path, /^\/jsp\/student\/right_/, key);
    assert.ok(spec.anchors.length >= 1, `${key} anchors`);
    assert.equal(typeof spec.web, "boolean", key);
  }
  assert.deepEqual(
    PAGE_KEYS.filter((k) => PAGES[k].web),
    ["grades", "documents", "unreportedAbsence", "attendanceReport", "assessmentCriteria"],
  );
});

test("contacts, bookings and files visit their page with the app session and run the extractor read-only", async () => {
  const { session, visited, options } = fakeSession({
    extractContacts: [{ title: "Elever", people: [] }],
    extractBookings: [{ title: "Utvecklingssamtal", slots: [] }],
    extractFiles: [{ name: "Veckobrev", url: "x", type: "file" }],
  });
  const portal = new BrowserPortal({ session });
  assert.deepEqual(await portal.getContacts(), [{ title: "Elever", people: [] }]);
  assert.deepEqual(await portal.getBookings(), [{ title: "Utvecklingssamtal", slots: [] }]);
  assert.deepEqual(await portal.getFiles(), [{ name: "Veckobrev", url: "x", type: "file" }]);
  assert.deepEqual(visited, [PAGES.contacts.path, PAGES.bookings.path, PAGES.files.path]);
  for (const o of options) {
    assert.equal(o.allowWrites, undefined, "never allows writes");
    assert.equal(o.web, false, "app session for non-gated pages");
  }
});

test("gated pages refuse without a web session and never navigate; with one they sync the child, use web cookies and run the table extractor", async () => {
  const page = { title: "Elevdokument", sections: [] };
  const { session, visited, options } = fakeSession({ extractTablePage: page });
  const noWeb = new BrowserPortal({ session, hasWebSession: () => false });
  await assert.rejects(noWeb.getGrades(), WebLoginRequiredError);
  await assert.rejects(noWeb.getAttendanceReport(), /login --web/);
  assert.deepEqual(visited, [], "no navigation without a web session");
  const order: string[] = [];
  const withWeb = new BrowserPortal({
    session,
    hasWebSession: () => true,
    syncWebChild: async () => {
      order.push("sync:" + visited.length);
    },
  });
  assert.deepEqual(await withWeb.getStudentDocuments(), page);
  await withWeb.getGrades();
  await withWeb.getUnreportedAbsence();
  await withWeb.getAttendanceReport();
  assert.deepEqual(visited, [
    PAGES.documents.path,
    PAGES.grades.path,
    PAGES.unreportedAbsence.path,
    PAGES.attendanceReport.path,
  ]);
  assert.deepEqual(
    order,
    ["sync:0", "sync:1", "sync:2", "sync:3"],
    "child sync before each gated visit",
  );
  assert.ok(
    options.every((o) => o.web === true),
    "gated pages ask for the web cookies",
  );
});

test("assessment criteria resolves the subject by name from the menu, then loads the page with its requestid", async () => {
  const links = [
    { subject: "Bild", url: "right_student_subject.jsp?requestid=1301", subjectId: 1301 },
    { subject: "Matematik", url: "right_student_subject.jsp?requestid=1302", subjectId: 1302 },
    {
      subject: "Svenska som andraspråk",
      url: "right_student_subject.jsp?requestid=1303",
      subjectId: 1303,
    },
  ];
  const { session, visited, options } = fakeSession({
    extractSubjectLinks: links,
    extractTablePage: { title: "", sections: [{ headers: ["Förmåga"], rows: [] }] },
  });
  const portal = new BrowserPortal({ session, hasWebSession: () => true });
  const exact = await portal.getAssessmentCriteria("matematik");
  assert.equal(exact.title, "Matematik", "empty page title falls back to the subject name");
  await portal.getAssessmentCriteria("andraspråk", 9);
  await portal.getAssessmentCriteria("BILD");
  assert.deepEqual(visited, [
    PAGES.subjects.path,
    PAGES.assessmentCriteria.path + "?subject=1302&schooltype=7",
    PAGES.subjects.path,
    PAGES.assessmentCriteria.path + "?subject=1303&schooltype=9",
    PAGES.subjects.path,
    PAGES.assessmentCriteria.path + "?subject=1301&schooltype=7",
  ]);
  assert.deepEqual(
    options.map((o) => o.web),
    [false, true, false, true, false, true],
    "menu under the app session, criteria page under the web session",
  );
  await assert.rejects(
    portal.getAssessmentCriteria("Kemi"),
    /No subject matching "Kemi".*Bild, Matematik/,
  );
  assert.equal(visited.length, 7, "unknown subject: menu read, gated page never loaded");
  assert.equal(normalizeSubject("  Svenska som Andraspråk "), "svenska som andrasprak");
});

test("criteria with an empty subject menu says so; the example-query resolver rejects an empty menu", async () => {
  const { session } = fakeSession({ extractSubjectLinks: [] });
  const portal = new BrowserPortal({ session, hasWebSession: () => true });
  await assert.rejects(portal.getAssessmentCriteria("Bild"), /Available: \(none\)\./);
  const page = { evaluate: async () => [] } as never;
  await assert.rejects(
    PAGES.assessmentCriteria.exampleQuery!.resolve(page),
    /no subject with an id/,
  );
});
