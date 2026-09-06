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
  extractSubjectTeachers,
  extractPageTitle,
} from "../../src/core/portal/extractors.js";

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
  "subject extractors: menu links deduplicated by href; teacher names from a subject page",
  { skip },
  async () => {
    const s = session();
    try {
      const links = await s.withPage(async (p) => {
        await p.goto("/right_student_subject.jsp.html");
        return p.evaluate(extractSubjectLinks);
      });
      assert.deepEqual(links, [
        { subject: "Bild", url: "right_student_subject.jsp?requestid=1301" },
        { subject: "Matematik", url: "right_student_subject.jsp?requestid=1302" },
      ]);
      const teachers = await s.withPage(async (p) => {
        await p.goto("/right_student_subject_one.jsp.html");
        return p.evaluate(extractSubjectTeachers);
      });
      assert.deepEqual(teachers, ["Bild Lärare"]);
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
