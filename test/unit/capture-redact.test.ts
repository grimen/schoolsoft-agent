/**
 * The capture redactor on SYNTHETIC samples only: fail closed (unknown text
 * becomes a placeholder), stable placeholders within one capture, known
 * names never kept, ids replaced by key and by shape, and the redacted
 * output passes the promote check.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Redactor } from "../../src/providers/schoolsoft/capture/redact.js";
import { scanForPersonalData } from "../../src/providers/schoolsoft/capture/scan.js";

const NAMES = ["Ada Exempelsson", "Bo Exempelsson", "Provskolan", "provort"];

/** An Översikt-like page: the real one has never been captured, so this is invented. */
const OVERVIEW = `<!doctype html>
<html lang="sv"><head><meta charset="utf-8"><title>Översikt</title>
<script>var user = { name: "Bo Exempelsson", id: 482913 };</script>
<style>.late { color: red }</style></head>
<body><!-- rendered for 19800101-1234 -->
<div id="top-box">Inloggad som Bo Exempelsson</div>
<div class="content_wrapper" id="content"><div class="h1">Översikt</div>
<table class="table lesson_status" id="status_482913">
<tr><th>Datum</th><th>Tid</th><th>Lektion</th><th>Status</th><th>Kommentar</th></tr>
<tr data-lesson="7788990" onclick="openLesson('right_student_lesson.jsp?lessonid=7788990', 7788990)">
<td>2026-09-21</td><td>08:30-09:50</td><td>Matematik 4B</td><td>Närvarande</td><td></td></tr>
<tr><td>Tisdag</td><td>10:10</td><td>Idrott &amp; hälsa</td><td>Sen ankomst 15 min</td><td>Ada kom från tandläkaren</td></tr>
<tr><td>v. 39</td><td>12:00</td><td>Mentorstid</td><td>Ogiltig frånvaro</td><td>Ring 070-123 45 67 eller ada@example.test</td></tr>
</table>
<a href="mailto:larare@example.test" title="Skicka till Lärare Lärarsson">Lärare Lärarsson</a>
<a href="/provort/jsp/student/right_student_lesson_status.jsp?week=39&amp;studentid=482913#top">Visa</a>
</div></body></html>`;

test("Översikt-like page: every unknown text node is replaced, interface words, dates and times stay", () => {
  const r = new Redactor({ knownNames: NAMES });
  const out = r.html(OVERVIEW);
  for (const kept of [
    "<td>2026-09-21</td>",
    "<td>08:30-09:50</td>",
    "<td>Närvarande</td>",
    "<td>Tisdag</td>",
    "<td>Sen ankomst 15 min</td>",
    "<td>v. 39</td>",
    "<td>Ogiltig frånvaro</td>",
    "<th>Kommentar</th>",
    "<title>Översikt</title>",
    ".late { color: red }",
  ])
    assert.ok(out.includes(kept), `kept ${kept}`);
  for (const gone of [
    "Matematik",
    "Idrott",
    "Mentorstid",
    "tandläkaren",
    "Exempelsson",
    "Lärarsson",
    "070-123",
    "example.test",
    "482913",
    "7788990",
    "19800101",
    "provort",
  ])
    assert.ok(!out.includes(gone), `removed ${gone}`);
  assert.match(out, /<td>\[text \d+\]<\/td>/);
  assert.ok(out.includes("<script></script>"), "script body dropped");
  assert.ok(!out.includes("<!--"), "comments dropped");
  assert.deepEqual(scanForPersonalData(out, { words: NAMES }), []);
});

test("placeholders are stable within one capture: same id or text, same placeholder", () => {
  const r = new Redactor();
  const out = r.html(
    '<tr id="row_55501"><td>Bild</td></tr><tr id="row_55502"><td>Bild</td></tr><a href="x.jsp?requestid=55501">Musik</a>',
  );
  assert.equal(
    out,
    '<tr id="row_1001"><td>[text 1]</td></tr><tr id="row_1002"><td>[text 1]</td></tr><a href="x.jsp?requestid=1001">[text 2]</a>',
  );
  assert.equal(r.text("  Bild \n"), "[text 1]", "whitespace does not make a new text");
  assert.equal(r.idNumber(55502), 1002);
  assert.equal(new Redactor().idNumber(55502), 1001, "a new capture starts over");
});

test("text rule: known names lose even when they look like interface words", () => {
  const r = new Redactor({ knownNames: ["Maj Sjuk", "X"] });
  assert.equal(r.isSafeText("maj"), false);
  assert.equal(r.isSafeText("Frånvaro"), true);
  assert.deepEqual(r.knownWords(), ["maj", "sjuk"], "one-letter words are ignored");
  assert.equal(r.isSafeText(""), true);
  assert.equal(r.isSafeText("   "), true);
  assert.equal(r.isSafeText("#A0b"), true);
  assert.equal(r.isSafeText("2026-09-21 - 2026-09-25"), true);
  assert.equal(r.isSafeText("2026-09-21T08:30:00+02:00"), true);
  assert.equal(r.isSafeText("fr.o.m. måndag t.o.m. fredag"), true);
  assert.equal(r.isSafeText("Vecka 27 till 52"), true);
  assert.equal(r.isSafeText("12345"), false, "more than four loose digits");
  assert.equal(r.isSafeText("Frånvaro @"), false, "a character outside the filler set");
  assert.equal(r.isSafeText("Frånvaro Kalle"), false);
});

test("codes, ids and texts", () => {
  const r = new Redactor({ knownNames: ["ada"] });
  assert.equal(r.code(""), "");
  assert.equal(r.code("7"), "7");
  assert.equal(r.code("sick_leave"), "sick_leave");
  assert.equal(r.code("EVENT"), "EVENT");
  assert.equal(r.code("ada"), "[text 1]", "a known name is not a code");
  assert.equal(r.code("123456"), "1001");
  assert.equal(r.code("Tandläkare"), "[text 2]");
  assert.equal(r.idString("abc-9"), "id-2");
  assert.equal(r.idString("abc-9"), "id-2");
  assert.equal(r.digits("f_12_345_6789"), "f_12_1003_1004");
});

test("urls: schemes, paths, queries and fragments", () => {
  const r = new Redactor({ knownNames: ["Provort", "Ada"] });
  assert.equal(r.url("mailto:a@b.test"), "mailto:[redacted]");
  assert.equal(r.url("TEL:0701234567"), "tel:[redacted]");
  assert.equal(r.url("javascript:open('Ada', 123456)"), "javascript:open('[text 1]', 1001)");
  assert.equal(r.url("/provort/jsp/x.jsp"), "/%5Btext%202%5D/jsp/x.jsp");
  assert.equal(r.url("/files/Ada%20IUP.pdf"), "/files/%5Btext%203%5D");
  assert.equal(r.url("x.jsp#Anchor Ada"), "x.jsp#[text 4]");
  assert.equal(
    r.url("x.jsp?action=view&flag&requestid=42&studentId=&q=%E0%A4%A&n%C3%A4mn=1&ada=2&child=Ada"),
    "x.jsp?action=view&flag&requestid=1002&studentId=&q=%5Btext%205%5D&%5Btext%206%5D=1&%5Btext%207%5D=2&child=%5Btext%201%5D",
  );
  assert.equal(r.url(""), "");
});

test("inline script: string literals and long numbers", () => {
  const r = new Redactor();
  assert.equal(
    r.script(`go("page.jsp?requestid=998877", 'mode', "Fri text", 12, 34567)`),
    `go("page.jsp?requestid=1001", 'mode', "[text 1]", 12, 1002)`,
  );
});

test("attributes: kept, identifiers, urls, handlers, values by element and type, data and unknown", () => {
  const r = new Redactor();
  const out = r.html(
    [
      '<form action="save.jsp?id=5551" method="post" onsubmit="check(5551)">',
      '<input type="hidden" name="token_5551" value="s3cr3t" required>',
      '<input type="text" value="Ada">',
      '<input type="submit" value="Skicka">',
      '<input type="button" value="Rensa allt nu">',
      '<input type="radio" value="2" checked><input type="checkbox" value="Egen text">',
      '<select><option value="9988776">Val</option></select>',
      '<li value="3" data-id="777" data-note="Fritext" title="Spara" alt="Anna" aria-label="Datum" placeholder="Skriv här">x</li>',
      "</form>",
    ].join(""),
  );
  assert.equal(
    out,
    [
      '<form action="save.jsp?id=1001" method="post" onsubmit="check(1001)">',
      '<input type="hidden" name="token_1001" value="" required>',
      '<input type="text" value="">',
      '<input type="submit" value="Skicka">',
      '<input type="button" value="[text 1]">',
      '<input type="radio" value="2" checked><input type="checkbox" value="[text 2]">',
      '<select><option value="1002">[text 3]</option></select>',
      '<li value="" data-id="1003" data-note="[text 4]" title="Spara" alt="[text 5]" aria-label="Datum" placeholder="[text 6]">[text 7]</li>',
      "</form>",
    ].join(""),
  );
});

test("html: textarea contents dropped, title redacted, entities re-escaped in placeholders", () => {
  const r = new Redactor();
  assert.equal(
    r.html(
      "<title>Ada &amp; Bo</title><textarea name=m>Hej</textarea><p>&lt;b&gt;</p><p>Frånvaro &amp; närvaro</p>",
    ),
    '<title>[text 1]</title><textarea name="m"></textarea><p>[text 2]</p><p>Frånvaro &amp; närvaro</p>',
  );
});

test("json: ids by key, big integers, texts, safe values and dates; structure kept", () => {
  const r = new Redactor({ knownNames: ["Ada"] });
  const agenda = [
    {
      eventId: 55443,
      name: "Utvecklingssamtal för Ada",
      startDate: "2026-09-30T08:00",
      endDate: "2026-09-30",
      allDay: false,
      description: null,
      room: "A12",
      category: "event",
      timezone: "Europe/Stockholm",
      teacherIds: [11, "x9"],
      student_id: "",
      externalId: "778899",
      participants: 3,
      created: 1758000000000,
      ratio: 1.5,
      byId: { "4455": { orgId: 20 } },
    },
  ];
  assert.deepEqual(r.json(agenda), [
    {
      eventId: 1001,
      name: "[text 1]",
      startDate: "2026-09-30T08:00",
      endDate: "2026-09-30",
      allDay: false,
      description: null,
      room: "A12",
      category: "event",
      timezone: "Europe/Stockholm",
      teacherIds: [1002, "id-3"],
      student_id: "",
      externalId: "1004",
      participants: 3,
      created: 1005,
      ratio: 1.5,
      byId: { "1006": { orgId: 1007 } },
    },
  ]);
  assert.equal(r.json("Ada"), "[text 2]");
});
