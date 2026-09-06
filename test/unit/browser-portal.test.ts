/**
 * BrowserPortal orchestration with a fake session: which pages it visits,
 * that extractors are run in-page, the subject-page cap, and the read-only
 * options it passes. The extractors themselves run against fixtures in real
 * Chromium in test/e2e-hosts/extractors.e2e.test.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { BrowserPortal, PAGES } from "../../src/core/portal/browser-portal.js";
import type {
  BrowserSession,
  PortalPage,
  WithPageOptions,
} from "../../src/core/browser/session.js";

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
    evaluate: async <T>(fn: () => T) => evaluateResults[fn.name] as T,
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

test("contacts, bookings and files visit their page and run the extractor read-only", async () => {
  const { session, visited, options } = fakeSession({
    extractContacts: [{ title: "Elever", people: [] }],
    extractBookings: [{ title: "Utvecklingssamtal", slots: [] }],
    extractFiles: [{ name: "Veckobrev", url: "x", type: "file" }],
  });
  const portal = new BrowserPortal({ session });
  assert.deepEqual(await portal.getContacts(), [{ title: "Elever", people: [] }]);
  assert.deepEqual(await portal.getBookings(), [{ title: "Utvecklingssamtal", slots: [] }]);
  assert.deepEqual(await portal.getFiles(), [{ name: "Veckobrev", url: "x", type: "file" }]);
  assert.deepEqual(visited, [PAGES.contacts, PAGES.bookings, PAGES.files]);
  for (const o of options) assert.equal(o.allowWrites, undefined, "never allows writes");
});

test("subject rooms: lists subjects from the menu then visits each subject page, capped", async () => {
  const links = [1, 2, 3].map((n) => ({
    subject: `Ämne ${n}`,
    url: `right_student_subject.jsp?requestid=${n}`,
  }));
  const { session, visited } = fakeSession({
    extractSubjectLinks: links,
    extractSubjectTeachers: ["Lärare X"],
  });
  const portal = new BrowserPortal({ session, maxSubjectPages: 2 });
  const rooms = await portal.getSubjectRooms();
  assert.equal(rooms.length, 2);
  assert.deepEqual(rooms[0], {
    subject: "Ämne 1",
    teachers: ["Lärare X"],
    url: "/jsp/student/right_student_subject.jsp?requestid=1",
  });
  assert.deepEqual(visited, [
    PAGES.subjects,
    "/jsp/student/right_student_subject.jsp?requestid=1",
    "/jsp/student/right_student_subject.jsp?requestid=2",
  ]);
});
