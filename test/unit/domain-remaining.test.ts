/**
 * The E4.5 mappers branch by branch: assignments, news, subject rooms (API
 * JSON), bookings, files (the browser pages' texts) and the gated pages'
 * tables and documents list. Every lenient decision (null, empty, a number
 * where text is expected) and every drift.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ResponseDriftError } from "../../src/core/errors/index.js";
import {
  AssignmentSchema,
  BookingSchema,
  NewsItemSchema,
  SharedFileSchema,
  StudentDocumentSchema,
  SubjectRoomSchema,
  TablePageSchema,
} from "../../src/core/domain/schemas.js";
import {
  toStudentDocuments,
  toTablePage,
} from "../../src/providers/schoolsoft/portal/domain/tables.js";
import { toAssignments } from "../../src/providers/schoolsoft/portal/domain/assignments.js";
import { toNews } from "../../src/providers/schoolsoft/portal/domain/news.js";
import {
  toRoomList,
  toSubjectRoom,
} from "../../src/providers/schoolsoft/portal/domain/subject-rooms.js";
import { toBookings } from "../../src/providers/schoolsoft/portal/domain/bookings.js";
import { toSharedFiles } from "../../src/providers/schoolsoft/portal/domain/files.js";
import { label, textHash } from "../../src/providers/schoolsoft/portal/domain/parse.js";
import {
  DRIFT_FIELDS,
  DRIFT_KINDS,
  driftedList,
  rawAssignments,
  rawNews,
  rawSubjectRooms,
  rawTeachers,
} from "../helpers/portal-json.js";

/** Asserts `fn` throws drift for `capability` whose detail starts with `path`. */
function drifts(fn: () => unknown, capability: string, path: RegExp) {
  assert.throws(fn, (e: unknown) => {
    assert.ok(e instanceof ResponseDriftError, String(e));
    assert.equal(e.where, capability);
    assert.match(e.detail, path);
    return true;
  });
}

test("labels: text or a number as trimmed text; empty, whitespace, null or absent is null", () => {
  assert.equal(label.parse("  Inlämnad "), "Inlämnad");
  assert.equal(label.parse(2), "2");
  for (const empty of ["", "  ", null, undefined]) assert.equal(label.parse(empty), null);
  assert.equal(label.safeParse(true).success, false);
});

test("ids: a text hash is 8 hex digits, stable, and differs for different text", () => {
  assert.equal(textHash("Utvecklingssamtal"), textHash("Utvecklingssamtal"));
  assert.match(textHash("Utvecklingssamtal"), /^[0-9a-f]{8}$/);
  assert.notEqual(textHash("a"), textHash("b"));
  assert.equal(textHash(""), "811c9dc5");
});

test("assignments: ids, subject room, subtitle, date or date-time, labels", () => {
  const out = toAssignments(rawAssignments());
  assert.deepEqual(out, [
    {
      id: 3101,
      title: "Läxa kapitel 3",
      subtitle: "Bråk och decimaltal",
      subjectRoomId: "subject-room:11",
      date: "2026-09-10",
      read: false,
      submissionStatus: "NOT_SUBMITTED",
      resultStatus: null,
    },
    {
      id: 3102,
      title: "Glosförhör",
      subtitle: null,
      subjectRoomId: "subject-room:12",
      date: "2026-09-11T08:30:00+02:00",
      read: true,
      submissionStatus: "2",
      resultStatus: "PUBLISHED",
    },
  ]);
  for (const a of out) assert.ok(AssignmentSchema.safeParse(a).success);
  const epoch = toAssignments([{ ...rawAssignments()[0], sortDate: Date.UTC(2026, 8, 10, 6) }]);
  assert.equal(epoch[0].date, "2026-09-10T08:00:00+02:00");
  for (const kind of DRIFT_KINDS)
    drifts(
      () => toAssignments(driftedList(rawAssignments(), DRIFT_FIELDS.assignments, kind)),
      "getAssignmentsWeek",
      /^0\.activityId /,
    );
  drifts(
    () => toAssignments([{ ...rawAssignments()[0], sortDate: "next week" }]),
    "getAssignmentsWeek",
    /^0\.sortDate /,
  );
  drifts(() => toAssignments({ items: [] }), "getAssignmentsWeek", /^\(root\) invalid_type/);
});

test("news: prefixed ids, optional text, label category, timestamps, visible-until", () => {
  const out = toNews(rawNews());
  assert.deepEqual(out, [
    {
      id: "news:401",
      title: "Studiedag fredag",
      body: "Skolan är stängd, fritids är öppet.",
      category: "Skolan",
      author: "Rektor Test",
      read: false,
      hasAttachments: true,
      publishedAt: "2026-09-01T07:45:00+02:00",
      visibleUntil: "2026-09-12",
    },
    {
      id: "news:402",
      title: "Fotografering",
      body: null,
      category: "3",
      author: null,
      read: true,
      hasAttachments: false,
      publishedAt: "2026-09-01T10:40:00+02:00",
      visibleUntil: null,
    },
  ]);
  for (const n of out) assert.ok(NewsItemSchema.safeParse(n).success);
  const [absent] = toNews([{ ...rawNews()[0], id: "a-1", toDate: undefined }]);
  assert.equal(absent.id, "news:a-1");
  assert.equal(absent.visibleUntil, null);
  const [timed] = toNews([{ ...rawNews()[0], toDate: "2026-12-01T16:00" }]);
  assert.equal(timed.visibleUntil, "2026-12-01T16:00:00+01:00");
  for (const kind of DRIFT_KINDS)
    drifts(() => toNews(driftedList(rawNews(), DRIFT_FIELDS.news, kind)), "getNews", /^0\.read /);
  drifts(() => toNews([{ ...rawNews()[0], author: { firstName: "A" } }]), "getNews", /^0\.author /);
});

test("subject rooms: rooms marked as not a subject room are left out; teachers named, roles as labels", () => {
  const rooms = toRoomList(rawSubjectRooms());
  assert.deepEqual(
    rooms.map((r) => [r.activityId, r.subject, r.groupNames]),
    [
      [11, "Matematik", ["4B"]],
      [12, "Engelska", []],
    ],
  );
  const room = toSubjectRoom(rooms[0], rawTeachers());
  assert.deepEqual(room, {
    id: "subject-room:11",
    name: "Matematik",
    groups: ["4B"],
    teachers: [
      { name: "Lärare Test", role: "Mentor" },
      { name: "Assistent", role: null },
    ],
  });
  assert.ok(SubjectRoomSchema.safeParse(room).success);
  const blank = toSubjectRoom(rooms[1], [{ firstName: " ", lastName: "" }]);
  assert.deepEqual(blank.teachers, [], "a teacher without a name is left out");
  for (const kind of DRIFT_KINDS) {
    drifts(
      () => toRoomList(driftedList(rawSubjectRooms(), DRIFT_FIELDS.subjectRooms, kind)),
      "getSubjectRooms",
      /^0\.activityId /,
    );
    const teachers = driftedList(rawTeachers(), DRIFT_FIELDS.teachers, kind);
    drifts(() => toSubjectRoom(rooms[0], teachers), "getSubjectRooms", /^0\.firstName /);
  }
});

/** A booking as the page extractor returns it. */
const pageBooking = (when: string, values: string[] = [], description?: string) => ({
  title: "Utvecklingssamtal",
  when,
  ...(description === undefined ? {} : { description }),
  details: values.map((value) => ({ label: "Status", value })),
});

test("bookings: time text to start and end, status from the page's words, stable ids", () => {
  const out = toBookings([
    pageBooking("2026-10-01 15:00 - 15:30", ["Bokad"], "Välkommen"),
    pageBooking("2026-11-12 18:00", ["Ledig"]),
    pageBooking(" 2026-12-01 ", ["Stängd"], "  "),
    pageBooking("2026-12-02 08:00-08:20", ["Passerad"]),
    pageBooking("2026-12-03 08:00", ["Tillgänglig"]),
    pageBooking("2026-12-04 08:00", ["Väntar"]),
    pageBooking("2026-12-05 08:00"),
  ]);
  assert.deepEqual(
    out.map((b) => [b.start, b.end, b.status, b.description]),
    [
      ["2026-10-01T15:00:00+02:00", "2026-10-01T15:30:00+02:00", "booked", "Välkommen"],
      ["2026-11-12T18:00:00+01:00", null, "available", null],
      ["2026-12-01", null, "closed", null],
      ["2026-12-02T08:00:00+01:00", "2026-12-02T08:20:00+01:00", "closed", null],
      ["2026-12-03T08:00:00+01:00", null, "available", null],
      ["2026-12-04T08:00:00+01:00", null, "unknown", null],
      ["2026-12-05T08:00:00+01:00", null, "unknown", null],
    ],
  );
  assert.equal(out[0].id, `booking:2026-10-01T15:00:00+02:00#${textHash("Utvecklingssamtal")}`);
  assert.deepEqual(out[0].details, [{ label: "Status", value: "Bokad" }]);
  assert.deepEqual(
    toBookings([pageBooking("2026-10-01 15:00 - 15:30", ["Bokad"])])[0].id,
    out[0].id,
  );
  for (const b of out) assert.ok(BookingSchema.safeParse(b).success);
  for (const bad of [
    "",
    "1 oktober 15:00",
    "2026-02-30",
    "2026-10-01 25:00",
    "2026-10-01 15:00 - 24:30",
  ])
    drifts(() => toBookings([pageBooking(bad)]), "getBookings", /^0\.when /);
  drifts(
    () => toBookings([{ ...pageBooking("2026-10-01"), title: "" }]),
    "getBookings",
    /^0\.title /,
  );
});

/** The page the files list is read from, as the browser reports it. */
const FILES_PAGE = "https://sms.schoolsoft.se/taby/jsp/student/right_student_library.jsp";

test("files: stored files by link, categories, hashed ids", () => {
  const out = toSharedFiles(
    [
      {
        name: "Veckobrev v37",
        url: "right_student_file_download.jsp?fileid=2",
        category: "Skolan",
      },
      { name: "Fritids hemsida", url: "https://example.test/fritids", category: "Skolan" },
      { name: "Lovdagar", url: "https://example.test/lov.PDF?x=1" },
      { name: "Schema", url: "http://example.test/schema.xlsx" },
    ],
    FILES_PAGE,
  );
  assert.deepEqual(
    out.map((f) => [f.name, f.kind, f.category]),
    [
      ["Veckobrev v37", "file", "Skolan"],
      ["Fritids hemsida", "link", "Skolan"],
      ["Lovdagar", "file", null],
      ["Schema", "file", null],
    ],
  );
  assert.equal(out[1].id, `file:${textHash("https://example.test/fritids")}`);
  for (const f of out) assert.ok(SharedFileSchema.safeParse(f).success);
  drifts(() => toSharedFiles([{ name: "x", url: "" }], FILES_PAGE), "getFiles", /^0\.url /);
  drifts(() => toSharedFiles("not a list", FILES_PAGE), "getFiles", /^\(root\) invalid_type/);
});

test("files: relative links become absolute on the portal, absolute ones stay, other schemes lose the url", () => {
  const [relative, rooted, absolute, plain, script, mail, broken] = toSharedFiles(
    [
      { name: "Veckobrev", url: "right_student_file_download.jsp?fileid=2" },
      { name: "Rot", url: "/taby/jsp/student/right_student_file_download.jsp?fileid=3" },
      { name: "Fritids", url: "https://example.test/fritids?a=1#b" },
      { name: "Gammal", url: " http://example.test/gammal.pdf " },
      { name: "Skript", url: "javascript:void(0)" },
      { name: "Mejl", url: "mailto:rektor@example.test" },
      { name: "Trasig", url: "http://[" },
    ],
    FILES_PAGE,
  );
  assert.equal(
    relative.url,
    "https://sms.schoolsoft.se/taby/jsp/student/right_student_file_download.jsp?fileid=2",
  );
  assert.equal(relative.kind, "file");
  assert.equal(
    rooted.url,
    "https://sms.schoolsoft.se/taby/jsp/student/right_student_file_download.jsp?fileid=3",
  );
  assert.equal(absolute.url, "https://example.test/fritids?a=1#b", "absolute links are kept");
  assert.equal(plain.url, "http://example.test/gammal.pdf");
  assert.equal(plain.kind, "file");
  for (const entry of [script, mail, broken]) {
    assert.equal(entry.url, null, entry.name);
    assert.equal(entry.kind, "link", entry.name);
    assert.ok(SharedFileSchema.safeParse(entry).success, entry.name);
  }
  assert.equal(
    script.id,
    `file:${textHash("javascript:void(0)")}`,
    "the id still identifies the entry",
  );
  assert.equal(
    SharedFileSchema.safeParse({ ...relative, url: "javascript:void(0)" }).success,
    false,
    "the schema itself refuses any other scheme",
  );
});

/** A documents page as the table extractor lifts it. */
const documentsTable = (rows: { cells: string[]; url?: string }[], headers = DOC_HEADERS) => ({
  title: "Elevdokument",
  sections: [
    { headers: [], rows: [] },
    { heading: "Arkiverade elevdokument", headers, rows },
  ],
});
const DOC_HEADERS = ["Rubrik", "Skapad av", "Datum", ""];
const docLink = (id: number, archive = true) =>
  `right_student_review.jsp?action=view${archive ? "&archive=1" : ""}&requestid=${id}`;

test("table pages: absent heading, message and link are null; nothing else changes", () => {
  assert.deepEqual(
    toTablePage(
      {
        title: "Närvarorapport",
        sections: [
          { headers: ["Orsak"], rows: [{ cells: ["Sjuk"] }, { cells: ["Ledig"], url: "x.jsp" }] },
        ],
      },
      "getAttendanceReport",
    ),
    {
      title: "Närvarorapport",
      message: null,
      sections: [
        {
          heading: null,
          headers: ["Orsak"],
          rows: [
            { cells: ["Sjuk"], link: null },
            { cells: ["Ledig"], link: "x.jsp" },
          ],
        },
      ],
    },
  );
  const page = toTablePage({ title: "Betyg", message: "Inget", sections: [] }, "getGrades");
  assert.ok(TablePageSchema.safeParse(page).success);
  drifts(() => toTablePage({ title: "Betyg" }, "getGrades"), "getGrades", /^sections /);
  drifts(
    () => toTablePage({ title: "x", sections: [{ headers: "Orsak", rows: [] }] }, "getGrades"),
    "getGrades",
    /^sections\.0\.headers /,
  );
});

test("student documents: columns found by heading, ids from the link, archived from the link", () => {
  const out = toStudentDocuments(
    documentsTable([
      { cells: ["IUP", "Lärare Exempel", "2026-01-10", ""], url: docLink(11) },
      { cells: ["Omdöme", " ", "2025-06-01", ""], url: docLink(12, false) },
    ]),
  );
  assert.deepEqual(out, [
    {
      id: "document:11",
      title: "IUP",
      createdBy: "Lärare Exempel",
      date: "2026-01-10",
      archived: true,
      link: docLink(11),
    },
    {
      id: "document:12",
      title: "Omdöme",
      createdBy: null,
      date: "2025-06-01",
      archived: false,
      link: docLink(12, false),
    },
  ]);
  for (const d of out) assert.ok(StudentDocumentSchema.safeParse(d).success);
  // columns in another order, headings in another case
  const moved = toStudentDocuments(
    documentsTable(
      [{ cells: ["2026-01-10", "IUP", "Lärare"], url: docLink(3) }],
      ["DATUM", "rubrik", " Skapad av "],
    ),
  );
  assert.deepEqual([moved[0].title, moved[0].date], ["IUP", "2026-01-10"]);
  assert.deepEqual(toStudentDocuments({ title: "Elevdokument", sections: [] }), []);
  drifts(
    () => toStudentDocuments(documentsTable([{ cells: ["IUP"], url: docLink(1) }], ["Titel"])),
    "getStudentDocuments",
    /^sections\.1\.headers not the documents columns$/,
  );
  drifts(
    () =>
      toStudentDocuments(documentsTable([{ cells: ["IUP", "L", "10 jan", ""], url: docLink(1) }])),
    "getStudentDocuments",
    /^0\.date not a date/,
  );
  drifts(
    () => toStudentDocuments(documentsTable([{ cells: ["IUP", "L", "2026-01-10", ""] }])),
    "getStudentDocuments",
    /^0\.link /,
  );
  drifts(
    () => toStudentDocuments(documentsTable([{ cells: ["", "L", "2026-01-10"], url: docLink(1) }])),
    "getStudentDocuments",
    /^0\.title /,
  );
});
