/**
 * Unit: the terminal helpers behind the text views (width, truncation,
 * sanitising, colour and width decisions), the label table and the
 * Stockholm date helpers.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bold,
  clean,
  colorEnabled,
  displayWidth,
  fit,
  outputWidth,
  padEnd,
} from "../../src/cli/text/terminal.js";
import { LABELS, label } from "../../src/cli/text/labels.js";
import { stockholm, stockholmDate, weekdayOf, dayHeading } from "../../src/cli/text/time.js";
import { table } from "../../src/cli/text/table.js";
import { cell } from "../../src/cli/text/render.js";

test("displayWidth: one column per grapheme, two for wide characters and emoji", () => {
  assert.equal(displayWidth("abc"), 3);
  assert.equal(displayWidth("åäö"), 3, "precomposed");
  assert.equal(displayWidth("åäö"), 3, "decomposed");
  assert.equal(displayWidth("日本"), 4);
  assert.equal(displayWidth("🍎a"), 3);
  assert.equal(displayWidth(""), 0);
});

test("fit: cuts at grapheme boundaries and ends in an ellipsis", () => {
  assert.equal(fit("Matematik", 9), "Matematik", "fits: unchanged");
  assert.equal(fit("Matematik", 5), "Mate…");
  assert.equal(fit("Kökstjänst", 4), "Kök…");
  assert.equal(fit("Kökstjänst", 4), "Kök…", "combining mark stays with its letter");
  assert.equal(fit("日本語", 4), "日…", "a wide character that would overflow is left out");
  assert.equal(fit("abc", 1), "…");
  assert.equal(fit("abc", 0), "");
});

test("padEnd pads by display width and never cuts", () => {
  assert.equal(padEnd("Två", 5), "Två  ");
  assert.equal(padEnd("Kök", 4), "Kök ");
  assert.equal(padEnd("long", 2), "long");
});

test("clean: one line, no control characters, no escapes", () => {
  assert.equal(clean("  Hej\n\tpå\r\ndig  "), "Hej på dig");
  assert.equal(clean("\u001b[31mRöd\u001b[0m\u0007"), "[31mRöd[0m");
  assert.equal(clean("a\u0085b\u009bc\u007f"), "abc", "C1 and DEL removed");
  assert.equal(cell(null), "–");
  assert.equal(cell("  "), "–");
  assert.equal(cell(" Rum 1 "), "Rum 1");
});

test("colorEnabled: only on a TTY, without NO_COLOR, not on a dumb terminal", () => {
  assert.equal(colorEnabled({ env: {}, isTTY: true }), true);
  assert.equal(
    colorEnabled({ env: { NO_COLOR: "" }, isTTY: true }),
    true,
    "empty NO_COLOR is unset",
  );
  assert.equal(colorEnabled({ env: { NO_COLOR: "1" }, isTTY: true }), false);
  assert.equal(colorEnabled({ env: { TERM: "dumb" }, isTTY: true }), false);
  assert.equal(colorEnabled({ env: {}, isTTY: false }), false);
  assert.equal(colorEnabled({ env: {} }), false);
  assert.equal(bold("x"), "\u001b[1mx\u001b[22m");
});

test("outputWidth: COLUMNS wins, then the TTY width, else no limit", () => {
  assert.equal(outputWidth({ env: { COLUMNS: "100" }, isTTY: true, columns: 60 }), 100);
  assert.equal(outputWidth({ env: { COLUMNS: "100" } }), 100, "also when piped");
  assert.equal(outputWidth({ env: { COLUMNS: "abc" }, isTTY: true, columns: 60 }), 60);
  assert.equal(outputWidth({ env: { COLUMNS: "10" }, isTTY: true, columns: 60 }), 60, "too small");
  assert.equal(outputWidth({ env: { COLUMNS: "80.5" } }), undefined);
  assert.equal(outputWidth({ env: {}, isTTY: true, columns: 5 }), undefined);
  assert.equal(outputWidth({ env: {}, isTTY: true }), undefined);
  assert.equal(outputWidth({ env: {}, isTTY: false, columns: 120 }), undefined);
});

test("table: aligns by display width; only the flexible column shrinks, not below its minimum", () => {
  const rows = [
    ["ID", "Namn", "Skola"],
    ["1", "Åsa", "Östra Påhittade skolan"],
  ];
  assert.deepEqual(table(rows, { flex: 2 }), [
    "ID  Namn  Skola",
    "1   Åsa   Östra Påhittade skolan",
  ]);
  assert.deepEqual(table(rows, { flex: 2, width: 22 }), [
    "ID  Namn  Skola",
    "1   Åsa   Östra Påhit…",
  ]);
  assert.deepEqual(table(rows, { flex: 2, width: 10 }), ["ID  Namn  Skola", "1   Åsa   Östra P…"]);
  assert.deepEqual(
    table([["a", "bb"]], { flex: 1, width: 1 }),
    ["a  bb"],
    "short flex column kept",
  );
});

test("labels: every key has English and Swedish, none empty", () => {
  const params = {
    name: "N",
    week: 1,
    year: 2026,
    child: "C",
    start: "s",
    end: "e",
    unread: 0,
    command: "x",
    date: "d",
  };
  for (const [key, entry] of Object.entries(LABELS)) {
    for (const lang of ["en", "sv"] as const) {
      assert.ok(lang in entry, `${key} lacks ${lang}`);
      const text = label(lang, key as keyof typeof LABELS, params);
      assert.ok(text.trim().length > 0, `${key}.${lang} is empty`);
    }
  }
  assert.equal(label("sv", "weekday1"), "mån");
  assert.equal(
    label("en", "fallback", { command: "get-news" }),
    "Text view is not available for get-news yet; showing JSON.",
  );
});

test("Stockholm time: instants on Stockholm's clock across DST, dates as given", () => {
  assert.deepEqual(stockholm("2026-09-07T08:30:00+02:00"), { date: "2026-09-07", time: "08:30" });
  assert.deepEqual(
    stockholm("2026-09-06T22:30:00Z"),
    { date: "2026-09-07", time: "00:30" },
    "UTC evening is Stockholm's next day",
  );
  assert.deepEqual(
    stockholm("2026-10-25T02:30:00+02:00"),
    { date: "2026-10-25", time: "02:30" },
    "fold, summer time",
  );
  assert.deepEqual(
    stockholm("2026-10-25T02:30:00+01:00"),
    { date: "2026-10-25", time: "02:30" },
    "fold, winter time",
  );
  assert.deepEqual(
    stockholm("2026-03-29T01:00:00Z"),
    { date: "2026-03-29", time: "03:00" },
    "after the spring gap",
  );
  assert.deepEqual(
    stockholm("2026-12-31T23:00:00Z"),
    { date: "2027-01-01", time: "00:00" },
    "midnight is 00, not 24",
  );
  assert.deepEqual(stockholm("2026-10-23"), { date: "2026-10-23", time: null });
  assert.equal(stockholmDate(Date.parse("2026-08-31T22:15:00Z")), "2026-09-01");
  assert.equal(weekdayOf("2026-08-31"), 1);
  assert.equal(weekdayOf("2026-09-06"), 7);
  assert.equal(dayHeading("sv", "2026-09-05"), "lör 2026-09-05");
});
