/**
 * Unit: every text view, in English and Swedish, against synthetic typed
 * results (test/helpers/text-fixtures.ts). The expected screens are stored
 * inline; a change to a view is a visible diff here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { TEXT_RENDERERS, textRenderer } from "../../src/cli/text/registry.js";
import { toText, type RenderContext } from "../../src/cli/text/render.js";
import { displayWidth } from "../../src/cli/text/terminal.js";
import {
  CALENDAR,
  CHILDREN,
  INBOX,
  LUNCH,
  SCHEDULE,
  SCHEDULE_AFTER_DST,
} from "../helpers/text-fixtures.js";

const TODAY = "2026-09-01";

function view(
  operation: string,
  data: unknown,
  ctx: Partial<RenderContext> = {},
  color = false,
): string {
  const full: RenderContext = { lang: "en", today: TODAY, ...ctx };
  return toText(textRenderer(operation)!(data, full), full.width, color);
}

const lines = (...l: string[]) => l.join("\n");

test("list-children: guardian, a row per child, the child in focus marked (en, sv)", () => {
  assert.equal(
    view("list_children", CHILDREN),
    lines(
      "Guardian: Test Testsson",
      "",
      "   ID   Name  School                  Class",
      "   100  Ett   Testskolan              4B",
      "*  101  Två   Östra Påhittade skolan  –",
      "",
      "* child in focus",
    ),
  );
  assert.equal(
    view("list_children", CHILDREN, { lang: "sv" }),
    lines(
      "Vårdnadshavare: Test Testsson",
      "",
      "   ID   Namn  Skola                   Klass",
      "   100  Ett   Testskolan              4B",
      "*  101  Två   Östra Påhittade skolan  –",
      "",
      "* barnet i fokus",
    ),
  );
});

test("get-schedule: a week view grouped by day, sorted, with times, rooms and today (en, sv)", () => {
  assert.equal(
    view("get_schedule", SCHEDULE),
    lines(
      "Week 36 · Ett",
      "",
      "Mon 2026-08-31",
      "  08:30–09:50  Matematik         A12",
      "  10:10–11:30  Svenska           B03",
      "",
      "Tue 2026-09-01 (today)",
      "  13:00–14:30  Idrott och hälsa  Gymnastiksalen",
      "",
      "Wed 2026-09-02",
      "  09:00–10:00  Engelska          –",
    ),
  );
  assert.equal(
    view("get_schedule", SCHEDULE, { lang: "sv" }),
    lines(
      "Vecka 36 · Ett",
      "",
      "mån 2026-08-31",
      "  08:30–09:50  Matematik         A12",
      "  10:10–11:30  Svenska           B03",
      "",
      "tis 2026-09-01 (idag)",
      "  13:00–14:30  Idrott och hälsa  Gymnastiksalen",
      "",
      "ons 2026-09-02",
      "  09:00–10:00  Engelska          –",
    ),
  );
});

test("get-schedule after the autumn change: +01:00 and UTC values shown on Stockholm's clock", () => {
  assert.equal(
    view("get_schedule", SCHEDULE_AFTER_DST),
    lines(
      "Week 44 · Ett",
      "",
      "Mon 2026-10-26",
      "  08:30–09:50  Matematik                          A12",
      "  10:10–11:30  Svenska                            B03",
      "",
      "Tue 2026-10-27",
      "  20:00–08:00  Lägerskola (until Wed 2026-10-28)  –",
    ),
  );
});

test("get-calendar: agenda by date, all-day and date-only first, the DST fold, multi-day (en, sv)", () => {
  assert.equal(
    view("get_calendar", CALENDAR),
    lines(
      "Calendar 2026-10-19 – 2026-10-25 · Ett",
      "",
      "Mon 2026-10-19",
      "  All day      Studiedag                       –",
      "  08:30–09:50  Matematik                       A12",
      "",
      "Tue 2026-10-20",
      "  All day      Friluftsdag                     Skogen",
      "",
      "Wed 2026-10-21",
      "  00:30–01:00  Midnattsfika                    Matsalen",
      "",
      "Fri 2026-10-23",
      "  All day      Höstlov (until Sun 2026-10-25)  –",
      "",
      "Sun 2026-10-25",
      "  02:30–02:45  Nattvandring (sommartid)        –",
      "  02:30–02:45  Nattvandring (vintertid)        –",
    ),
  );
  assert.equal(
    view("get_calendar", CALENDAR, { lang: "sv" }),
    lines(
      "Kalender 2026-10-19 – 2026-10-25 · Ett",
      "",
      "mån 2026-10-19",
      "  Heldag       Studiedag                      –",
      "  08:30–09:50  Matematik                      A12",
      "",
      "tis 2026-10-20",
      "  Heldag       Friluftsdag                    Skogen",
      "",
      "ons 2026-10-21",
      "  00:30–01:00  Midnattsfika                   Matsalen",
      "",
      "fre 2026-10-23",
      "  Heldag       Höstlov (till sön 2026-10-25)  –",
      "",
      "sön 2026-10-25",
      "  02:30–02:45  Nattvandring (sommartid)       –",
      "  02:30–02:45  Nattvandring (vintertid)       –",
    ),
  );
});

test("get-calendar: the spring gap and a date-only entry that is not flagged all-day", () => {
  const spring = {
    ...CALENDAR,
    startDate: "2026-03-29",
    endDate: "2026-03-29",
    events: [
      {
        ...CALENDAR.events[0],
        title: "Efter omställningen",
        start: "2026-03-29T03:30:00+02:00",
        end: "2026-03-29T04:00:00+02:00",
      },
      {
        ...CALENDAR.events[0],
        title: "Före omställningen",
        start: "2026-03-29T01:30:00+01:00",
        end: "2026-03-29T01:45:00+01:00",
      },
      {
        ...CALENDAR.events[0],
        title: "Påsklov",
        allDay: false,
        start: "2026-03-29",
        end: "2026-03-29T12:00:00+02:00",
      },
    ],
  };
  assert.equal(
    view("get_calendar", spring),
    lines(
      "Calendar 2026-03-29 – 2026-03-29 · Ett",
      "",
      "Sun 2026-03-29",
      "  All day      Påsklov              A12",
      "  01:30–01:45  Före omställningen   A12",
      "  03:30–04:00  Efter omställningen  A12",
    ),
  );
});

test("get-lunch-menu: Monday to Friday, missing days, kinds, a listed Saturday, today (en, sv)", () => {
  assert.equal(
    view("get_lunch_menu", LUNCH),
    lines(
      "Lunch, week 36 2026 · Ett",
      "",
      "Mon 2026-08-31          Lunch: Köttbullar med potatismos",
      "                        Vegetarisk: Linsbiffar",
      "Tue 2026-09-01 (today)  No menu",
      "Wed 2026-09-02          Fiskgratäng",
      "Thu 2026-09-03          No menu",
      "Fri 2026-09-04          Pannkakor",
      "Sat 2026-09-05          Helg: Soppa",
    ),
  );
  assert.equal(
    view("get_lunch_menu", LUNCH, { lang: "sv" }),
    lines(
      "Lunch, vecka 36 2026 · Ett",
      "",
      "mån 2026-08-31         Lunch: Köttbullar med potatismos",
      "                       Vegetarisk: Linsbiffar",
      "tis 2026-09-01 (idag)  Ingen meny",
      "ons 2026-09-02         Fiskgratäng",
      "tor 2026-09-03         Ingen meny",
      "fre 2026-09-04         Pannkakor",
      "lör 2026-09-05         Helg: Soppa",
    ),
  );
});

test("get-messages: inbox with unread and attachment markers, Stockholm time, cleaned subjects (en, sv)", () => {
  assert.equal(
    view("get_messages", INBOX),
    lines(
      "Inbox (2 unread)",
      "",
      "    ID  Date              From         Subject",
      "*+  7   2026-09-03 16:45  Åsa Lärare   Utflykt på fredag",
      "    6   2026-08-28 09:00  –            Veckobrev",
      "*   5   2026-08-28 00:30  Rektor Test  Föräldramöte [31mnästa vecka",
      "",
      "* unread · + attachment",
    ),
  );
  assert.equal(
    view("get_messages", INBOX, { lang: "sv" }),
    lines(
      "Inkorg (2 olästa)",
      "",
      "    ID  Datum             Från         Ämne",
      "*+  7   2026-09-03 16:45  Åsa Lärare   Utflykt på fredag",
      "    6   2026-08-28 09:00  –            Veckobrev",
      "*   5   2026-08-28 00:30  Rektor Test  Föräldramöte [31mnästa vecka",
      "",
      "* oläst · + bilaga",
    ),
  );
});

test("empty states are sentences, in both languages", () => {
  const child = { id: 100, firstName: "Ett" };
  const cases: [string, unknown, string, string][] = [
    [
      "list_children",
      { guardianName: "Test Testsson", children: [], childInFocus: 0 },
      "No children on this account.",
      "Inga barn på det här kontot.",
    ],
    [
      "get_schedule",
      { week: 36, child, lessons: [] },
      "No lessons this week.",
      "Inga lektioner den här veckan.",
    ],
    [
      "get_calendar",
      { ...CALENDAR, events: [] },
      "Nothing in the calendar for this period.",
      "Inget i kalendern för den här perioden.",
    ],
    [
      "get_lunch_menu",
      { ...LUNCH, days: [] },
      "No lunch menu for this week.",
      "Ingen lunchmeny den här veckan.",
    ],
    ["get_messages", { messages: [] }, "No messages.", "Inga meddelanden."],
  ];
  for (const [op, data, en, sv] of cases) {
    const shown = view(op, data).split("\n");
    assert.equal(shown.at(-1), en, op);
    assert.equal(shown[1], "", op);
    assert.equal(view(op, data, { lang: "sv" }).split("\n").at(-1), sv, op);
  }
  assert.equal(
    view("get_messages", { messages: [] }),
    lines("Inbox (0 unread)", "", "No messages."),
  );
});

test("width: the flexible column shrinks first, every line fits, å/ä/ö count as one column", () => {
  const narrow = view("get_messages", INBOX, { width: 44 });
  assert.equal(
    narrow,
    lines(
      "Inbox (2 unread)",
      "",
      "    ID  Date              From         Subj…",
      "*+  7   2026-09-03 16:45  Åsa Lärare   Utfl…",
      "    6   2026-08-28 09:00  –            Veck…",
      "*   5   2026-08-28 00:30  Rektor Test  Förä…",
      "",
      "* unread · + attachment",
    ),
  );
  for (const line of narrow.split("\n")) assert.ok(displayWidth(line) <= 44, line);
  // Narrower than the minimum flexible column: the line itself is cut.
  const tiny = view("list_children", CHILDREN, { width: 20 }).split("\n");
  assert.deepEqual(tiny.slice(3, 5), ["   100  Ett   Tests…", "*  101  Två   Östra…"]);
  for (const line of tiny) assert.ok(displayWidth(line) <= 20, line);
  // Decomposed å (a + combining ring) is one column and is never split from its ring.
  const decomposed = {
    ...SCHEDULE,
    lessons: [{ ...SCHEDULE.lessons[0], title: "Sa\u030Angstund och mer" }],
  };
  const cut = view("get_schedule", decomposed, { width: 20, today: "x" }).split("\n")[3];
  assert.equal(cut, "  10:10–11:30  Sa\u030Ang…");
  assert.equal(displayWidth(cut), 20);
});

test("emphasis: bold only when colour is on, after cutting; the plain text keeps the markers", () => {
  const plain = view("get_messages", INBOX);
  assert.ok(!plain.includes("\u001b"), "no escapes without colour");
  const colored = view("get_messages", INBOX, { width: 44 }, true).split("\n");
  assert.equal(colored[3], "\u001b[1m*+  7   2026-09-03 16:45  Åsa Lärare   Utfl…\u001b[22m");
  assert.equal(colored[4], "    6   2026-08-28 09:00  –            Veck…", "read rows stay plain");
  const today = view("get_schedule", SCHEDULE, {}, true).split("\n");
  assert.equal(today[6], "\u001b[1mTue 2026-09-01 (today)\u001b[22m");
  const lunch = view("get_lunch_menu", LUNCH, {}, true).split("\n");
  assert.equal(lunch[4], "\u001b[1mTue 2026-09-01 (today)  No menu\u001b[22m");
});

test("views do not depend on the machine's time zone", () => {
  const before = process.env.TZ;
  const shown = view("get_calendar", CALENDAR);
  try {
    for (const tz of ["UTC", "America/Los_Angeles", "Asia/Tokyo"]) {
      process.env.TZ = tz;
      assert.equal(view("get_calendar", CALENDAR), shown, tz);
      assert.equal(view("get_messages", INBOX), view("get_messages", INBOX), tz);
    }
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
});

test("registry: lookups by operation name only", () => {
  assert.equal(textRenderer("get_news"), undefined);
  assert.equal(textRenderer("toString"), undefined, "no prototype keys");
  assert.equal(textRenderer("get_schedule"), TEXT_RENDERERS.get_schedule);
});
