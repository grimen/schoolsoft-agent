/**
 * The DOM extractors against synthetic fixtures in REAL Chromium, through the
 * production PlaywrightSession (cookies, guard, redirect detection) with a
 * file:// origin. Hermetic: no SchoolSoft. Skips with a reason when
 * playwright/Chromium is not installed (CI installs it for this suite).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { browserStatus } from "../../src/core/browser/install.js";
import { PlaywrightSession } from "../../src/core/browser/playwright.js";
import {
  extractBookings,
  extractContacts,
  extractFiles,
  extractSubjectLinks,
  extractPageTitle,
  extractTablePage,
} from "../../src/providers/schoolsoft/portal/extractors.js";
import { inspectPage } from "../../src/core/portal/inspect.js";
import { PAGES } from "../../src/providers/schoolsoft/portal/pages.js";

const fixtures = join(process.cwd(), "test", "fixtures", "jsp");
const status = await browserStatus({ kind: "chromium" });
const skip = status.ready ? false : `headless browser not installed (${status.hint})`;

// file:// origin: cookies are not applicable, so the session gets a dummy header.
function session() {
  return new PlaywrightSession({
    school: "",
    cookieHeader: () => "x=1",
    origin: pathToFileURL(fixtures).toString().replace(/\/$/, ""),
  });
}

test(
  "contacts extractor: groups, people, e-mail from mailto, role and phone",
  { skip },
  async () => {
    const s = session();
    try {
      const groups = await s.withPage(async (p) => {
        await p.goto("/right_student_class.jsp.html");
        assert.equal(await p.evaluate(extractPageTitle), "Kontaktlistor");
        return p.evaluate(extractContacts);
      });
      assert.deepEqual(
        groups.map((g) => [g.title, g.people.length]),
        [
          ["Elever", 2],
          ["Personal", 1],
        ],
      );
      assert.deepEqual(groups[0].people[0], {
        name: "Anna Exempel",
        role: "",
        email: "anna.exempel@skola.example",
      });
      assert.deepEqual(groups[1].people[0], {
        name: "Lärare Exempel",
        role: "Mentor",
        email: "larare@skola.example",
        phone: "08-123 45 67",
      });
    } finally {
      await s.close();
    }
  },
);

test(
  "subject menu extractor: links deduplicated by href, requestid as subjectId",
  { skip },
  async () => {
    const s = session();
    try {
      const links = await s.withPage(async (p) => {
        await p.goto("/right_student_subject.jsp.html");
        return p.evaluate(extractSubjectLinks);
      });
      assert.deepEqual(links, [
        { subject: "Bild", url: "right_student_subject.jsp?requestid=1301", subjectId: 1301 },
        { subject: "Matematik", url: "right_student_subject.jsp?requestid=1302", subjectId: 1302 },
      ]);
    } finally {
      await s.close();
    }
  },
);

test(
  "inspectPage: anchor counts, a fingerprint that ignores text/data and differs between pages",
  { skip },
  async () => {
    const s = session();
    try {
      const load = (f: string, anchors: string[]) =>
        s.withPage(async (p) => {
          await p.goto("/" + f);
          return p.evaluate(inspectPage, anchors);
        });
      const a = await load("right_student_class.jsp.html", [
        "#content .h1",
        "#contAll_content",
        "#nope",
      ]);
      assert.equal(a.title, "Kontaktlistor");
      assert.deepEqual(a.anchors, { "#content .h1": 1, "#contAll_content": 1, "#nope": 0 });
      assert.match(a.fingerprint, /^[0-9a-f]{8}$/);
      const again = await load("right_student_class.jsp.html", []);
      assert.equal(again.fingerprint, a.fingerprint, "stable across loads");
      const b = await load("right_student_review.jsp.html", []);
      assert.notEqual(b.fingerprint, a.fingerprint, "different pages, different skeletons");
      for (const [file, key] of [
        ["right_student_review.jsp.html", "documents"],
        ["right_parent_absence_message.jsp.html", "unreportedAbsence"],
        ["right_student_absence_student.jsp.html", "attendanceReport"],
        ["right_student_ability.jsp.html", "assessmentCriteria"],
        ["right_student_gradesubject.jsp.html", "grades"],
        ["right_student_timebooking.jsp.html", "bookings"],
        ["right_student_library.jsp.html", "files"],
        ["right_student_subject.jsp.html", "subjects"],
      ] as const) {
        const r = await load(file, [...PAGES[key].anchors]);
        const missing = PAGES[key].anchors.filter((x) => r.anchors[x] === 0);
        assert.deepEqual(missing, [], `fixture ${file} satisfies its page anchors`);
      }
    } finally {
      await s.close();
    }
  },
);

test("bookings extractor: title, date, description, status words", { skip }, async () => {
  const s = session();
  try {
    const b = await s.withPage(async (p) => {
      await p.goto("/right_student_timebooking.jsp.html");
      return p.evaluate(extractBookings);
    });
    assert.equal(b.length, 2);
    assert.equal(b[0].title, "Utvecklingssamtal höstterminen");
    assert.equal(b[0].slots[0].start, "2026-10-01 15:00 - 15:30");
    assert.equal(b[0].slots[0].status, "booked");
    assert.match(b[0].description ?? "", /^Välkommen/);
    assert.equal(b[1].slots[0].status, "available");
  } finally {
    await s.close();
  }
});

test("files extractor: categories from headings, file vs link", { skip }, async () => {
  const s = session();
  try {
    const f = await s.withPage(async (p) => {
      await p.goto("/right_student_library.jsp.html");
      return p.evaluate(extractFiles);
    });
    assert.deepEqual(
      f.map((x) => [x.name, x.type, x.category]),
      [
        ["Veckobrev v37", "file", "Skolan"],
        ["Fritids hemsida", "link", "Skolan"],
        ["Lovdagar 2026", "file", "Kommunen"],
      ],
    );
  } finally {
    await s.close();
  }
});

test(
  "table-page extractor: documents (longlist + links), attendance (th headers), message page, criteria matrix, empty grades",
  { skip },
  async () => {
    const s = session();
    try {
      const load = (f: string) =>
        s.withPage(async (p) => {
          await p.goto("/" + f);
          return p.evaluate(extractTablePage);
        });
      const docs = await load("right_student_review.jsp.html");
      assert.equal(docs.title, "Elevdokument");
      assert.equal(docs.sections.length, 1);
      assert.equal(docs.sections[0].heading, "Arkiverade elevdokument");
      assert.deepEqual(docs.sections[0].headers, ["Rubrik", "Skapad av", "Datum", ""]);
      assert.deepEqual(docs.sections[0].rows[0], {
        cells: ["IUP höstterminen", "Lärare Exempel", "2026-01-10", ""],
        url: "right_student_review.jsp?action=view&archive=1&requestid=11",
      });
      assert.equal(docs.sections[0].rows.length, 2);
      const att = await load("right_student_absence_student.jsp.html");
      assert.equal(att.sections.length, 1, "the filter form's table is ignored");
      assert.deepEqual(att.sections[0].headers, ["Orsak", "Lektioner", "Timmar"]);
      assert.deepEqual(
        att.sections[0].rows.map((r) => r.cells),
        [
          ["Sjuk", "2", "1,5"],
          ["Beviljad ledighet", "1", "1"],
        ],
      );
      const msg = await load("right_parent_absence_message.jsp.html");
      assert.equal(msg.message, "Det finns ingen oanmäld frånvaro att ta del av");
      assert.deepEqual(msg.sections, []);
      const crit = await load("right_student_ability.jsp.html");
      assert.equal(crit.sections.length, 1);
      assert.deepEqual(crit.sections[0].headers, ["Förmåga", "", "Nivå C", "Nivå A"]);
      assert.equal(crit.sections[0].rows.length, 2, "empty spacer row dropped");
      assert.equal(crit.sections[0].rows[1].cells[0], "Skapa bilder");
      const grades = await load("right_student_gradesubject.jsp.html");
      assert.equal(grades.title, "Betyg");
      assert.deepEqual(grades.sections, [], "session-warning table under #top-box is not content");
    } finally {
      await s.close();
    }
  },
);
