/**
 * E4.2, E4.3 and E4.5 (group A) through the production wiring: the typed
 * operations return domain objects mapped from live-shaped synthetic JSON (and,
 * for the browser-served ones, from the texts a page extractor returns), MCP publishes
 * their outputSchema, and a drifted answer (a renamed, a missing or a
 * wrong-typed field) is one error naming the operation at every surface:
 * an MCP error result, a CLI exit 7 with two lines. The answer is never
 * cached and the saved session survives. The connector's side is in
 * test/unit/http-runtime.test.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  MemorySessionHistoryStore,
  MemorySessionStore,
  createPortals,
  createSessionManager,
  getOperation,
  operations,
  resolveConfig,
  runOperation,
  type OperationContext,
} from "../../src/core/index.js";
import { ResponseDriftError } from "../../src/core/errors/index.js";
import { isoWeekDate } from "../../src/core/domain/time.js";
import { lunchYear } from "../../src/core/operations/get-lunch-menu.js";
import { weekOf } from "../../src/core/operations/_week.js";
import { schoolsoftProvider } from "../../src/providers/schoolsoft/index.js";
import { BrowserPortal } from "../../src/providers/schoolsoft/portal/browser-portal.js";
import { textHash } from "../../src/providers/schoolsoft/portal/domain/parse.js";
import type { BrowserSession, PortalPage } from "../../src/core/browser/session.js";
import { createMcpServer } from "../../src/mcp/server.js";
import { runCli } from "../../src/cli/program.js";
import { EXIT } from "../../src/cli/exit-codes.js";
import { SchoolsoftSim, savedSession } from "../helpers/schoolsoft-sim.js";
import {
  DRIFT_FIELDS,
  DRIFT_KINDS,
  drift,
  driftedList,
  rawAssignments,
  rawNews,
  rawSubjectRooms,
  rawTeachers,
  driftedParent,
  rawAgendaEvents,
  rawAgendaLessons,
  rawInbox,
  rawLessonsWeek,
  rawLunch,
  rawParent,
  type DriftKind,
} from "../helpers/portal-json.js";

const TYPED = [
  "list_children",
  "get_schedule",
  "get_calendar",
  "get_lunch_menu",
  "get_assignments",
  "get_news",
  "get_messages",
  "get_subject_rooms",
  "get_bookings",
  "get_files",
];

/** What the bookings and files pages' extractors return (their texts), by extractor name. */
const pageBookings = () => [
  {
    title: "Utvecklingssamtal",
    when: "2026-10-01 15:00 - 15:30",
    description: "Välkommen",
    details: [{ label: "Status", value: "Bokad" }],
  },
  { title: "Föräldramöte", when: "2026-11-12 18:00", details: [] },
];
const pageFiles = () => [
  { name: "Veckobrev v37", url: "right_student_file_download.jsp?fileid=2", category: "Skolan" },
  { name: "Fritids hemsida", url: "https://example.test/fritids" },
];

/** A browser session that serves the extractors' results and counts them; it never loads a page. */
function fakeBrowser(pages: Map<string, () => unknown>, visits: string[]): BrowserSession {
  const page: PortalPage = {
    goto: async () => {},
    url: () => "https://sms.schoolsoft.se/taby/jsp/student/",
    evaluate: async <T, A>(fn: (arg: A) => T) => {
      visits.push(fn.name);
      return pages.get(fn.name)!() as T;
    },
    waitForJson: async () => ({}) as never,
  };
  return { withPage: async (fn) => fn(page), close: async () => {} };
}

/** Production wiring over the offline stand-in, a saved session and fixture answers. */
function wired() {
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
  const pages = new Map<string, () => unknown>([
    ["extractBookings", pageBookings],
    ["extractFiles", pageFiles],
  ]);
  const visits: string[] = [];
  const browser = new BrowserPortal({ session: fakeBrowser(pages, visits) });
  const portals = createPortals(manager, { fetchImpl: sim.fetch, browser });
  const ctx: OperationContext = {
    manager,
    config,
    provider: schoolsoftProvider,
    log: () => {},
    ...portals,
  };
  const fixtures: [RegExp, () => unknown][] = [
    [/\/eva\/api\/v1\/parent$/, rawParent],
    [/\/calendar\/lessons\/week\/\d+$/, rawLessonsWeek],
    [/\/calendar\/lessons\/agenda$/, rawAgendaLessons],
    [/\/calendar\/event\/agenda$/, rawAgendaEvents],
    [/\/lunchmenu\/\d+$/, rawLunch],
    [/\/messages\/inbox$/, rawInbox],
    [/\/ps\/assignments\/start-page$/, rawAssignments],
    [/\/news$/, rawNews],
    [/\/ps\/subjectroom\/all$/, rawSubjectRooms],
    [/\/ps\/subjectroom\/\d+\/teachers$/, rawTeachers],
  ];
  const answers = new Map<RegExp, () => unknown>(fixtures);
  sim.override = (pathname) => {
    for (const [pattern, answer] of answers) if (pattern.test(pathname)) return answer();
    return undefined;
  };
  /** Every read that reached the portal: HTTP requests and browser page reads. */
  const reads = () => sim.requests.length + visits.length;
  return { sim, store, ctx, answers, pages, reads };
}

const ARGS: Record<string, Record<string, unknown>> = {
  list_children: {},
  get_schedule: { week: 37 },
  get_calendar: { start_date: "2026-09-07", end_date: "2026-09-13" },
  get_lunch_menu: { week: 37 },
  get_assignments: { week: 37, year: 2026 },
  get_news: {},
  get_messages: {},
  get_subject_rooms: {},
  get_bookings: {},
  get_files: {},
};

const run = (ctx: OperationContext, name: string) =>
  runOperation(getOperation(name)!, ctx, ARGS[name] as never) as Promise<Record<string, unknown>>;

test("MCP publishes an outputSchema for exactly the typed operations", async () => {
  const server = createMcpServer({ getContext: () => ({}) as OperationContext });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "typed", version: "1" });
  await Promise.all([server.connect(st), client.connect(ct)]);
  const { tools } = await client.listTools();
  const typed = tools.filter((tool) => tool.outputSchema).map((tool) => tool.name);
  assert.deepEqual(typed.sort(), TYPED.map((name) => "schoolsoft_" + name).sort());
  const schedule = tools.find((tool) => tool.name === "schoolsoft_get_schedule")!;
  assert.deepEqual(Object.keys(schedule.outputSchema!.properties!).sort(), [
    "child",
    "endDate",
    "lessons",
    "startDate",
    "week",
    "year",
  ]);
  assert.equal(tools.length, 25);
  assert.deepEqual(
    operations.filter((op) => op.output).map((op) => op.name),
    TYPED,
  );
  await client.close();
});

test("the five operations map live-shaped JSON to the domain model", async () => {
  const { ctx } = wired();
  assert.deepEqual(await run(ctx, "list_children"), {
    guardianName: "Synthetic Guardian",
    children: [
      { id: 100, firstName: "Ett", schoolName: "Testskolan", className: "4B" },
      { id: 101, firstName: "Två", schoolName: "Testskolan", className: "1A" },
    ],
    childInFocus: 100,
  });
  const child = { id: 100, firstName: "Ett" };
  assert.deepEqual(await run(ctx, "get_schedule"), {
    ...weekOf(37),
    child,
    lessons: [
      {
        id: "lesson:5001@2026-09-07T08:30:00+02:00",
        title: "Matematik",
        start: "2026-09-07T08:30:00+02:00",
        end: "2026-09-07T09:50:00+02:00",
        room: "A12",
        group: "4B",
        teacher: "Lärare Test",
        note: "Kapitel 3",
      },
      {
        id: "lesson:5002@2026-09-07T10:10:00+02:00",
        title: "Svenska",
        start: "2026-09-07T10:10:00+02:00",
        end: "2026-09-07T11:30:00+02:00",
        room: null,
        group: "4B",
        teacher: "Lärare Test",
        note: null,
      },
    ],
  });
  const calendar = await run(ctx, "get_calendar");
  assert.deepEqual(
    (calendar.events as { id: string; kind: string; start: string; category: string | null }[]).map(
      (e) => [e.id, e.kind, e.start, e.category],
    ),
    [
      ["lesson:7001@2026-09-07T08:30:00+02:00", "lesson", "2026-09-07T08:30:00+02:00", "lesson"],
      ["lesson:7002@2026-09-07T11:30:00+02:00", "lesson", "2026-09-07T11:30:00+02:00", "lunch"],
      ["event:9001@2026-09-11", "event", "2026-09-11", null],
    ],
  );
  assert.deepEqual(
    { ...calendar, events: undefined },
    {
      startDate: "2026-09-07",
      endDate: "2026-09-13",
      timezone: "Europe/Stockholm",
      child,
      events: undefined,
    },
  );
  const year = lunchYear(37);
  assert.deepEqual(await run(ctx, "get_lunch_menu"), {
    year,
    week: 37,
    child,
    days: [
      {
        date: isoWeekDate(year, 37, 1),
        weekday: 1,
        dishes: [
          { kind: "Lunch", description: "Köttbullar med potatis" },
          { kind: "Vegetarisk", description: "Falafel" },
        ],
      },
      {
        date: isoWeekDate(year, 37, 5),
        weekday: 5,
        dishes: [{ kind: "Lunch", description: "Spagetti" }],
      },
    ],
  });
  assert.deepEqual(await run(ctx, "get_messages"), {
    messages: [
      {
        id: 5,
        subject: "Utflykt fredag",
        preview: "Ta med matsäck",
        read: false,
        sender: { name: "Lärare Test" },
        sentAt: "2026-09-01T14:05:00+02:00",
        hasAttachments: false,
      },
      {
        id: 6,
        subject: "Veckobrev",
        preview: "Veckans händelser",
        read: true,
        sender: { name: "Rektor Test" },
        sentAt: "2026-08-28T09:00:00+02:00",
        hasAttachments: true,
      },
    ],
  });
});

/** The relative download link, resolved against the files page. */
const DOWNLOAD =
  "https://sms.schoolsoft.se/taby/jsp/student/right_student_file_download.jsp?fileid=2";

test("group A: assignments, news, subject rooms, bookings and files map to the domain model", async () => {
  const { ctx } = wired();
  const child = { id: 100, firstName: "Ett" };
  const assignments = await run(ctx, "get_assignments");
  assert.deepEqual(
    { ...assignments, assignments: undefined },
    {
      week: 37,
      year: 2026,
      child,
      assignments: undefined,
    },
  );
  assert.deepEqual(assignments.assignments, [
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
  const news = await run(ctx, "get_news");
  assert.deepEqual(news.child, child);
  assert.deepEqual(
    (news.news as { id: string; publishedAt: string; visibleUntil: string | null }[]).map((n) => [
      n.id,
      n.publishedAt,
      n.visibleUntil,
    ]),
    [
      ["news:401", "2026-09-01T07:45:00+02:00", "2026-09-12"],
      ["news:402", "2026-09-01T10:40:00+02:00", null],
    ],
  );
  const teachers = [
    { name: "Lärare Test", role: "Mentor" },
    { name: "Assistent", role: null },
  ];
  assert.deepEqual(await run(ctx, "get_subject_rooms"), {
    child,
    rooms: [
      { id: "subject-room:11", name: "Matematik", groups: ["4B"], teachers },
      { id: "subject-room:12", name: "Engelska", groups: [], teachers },
    ],
  });
  assert.deepEqual(await run(ctx, "get_bookings"), {
    child,
    bookings: [
      {
        id: `booking:2026-10-01T15:00:00+02:00#${textHash("Utvecklingssamtal")}`,
        title: "Utvecklingssamtal",
        description: "Välkommen",
        start: "2026-10-01T15:00:00+02:00",
        end: "2026-10-01T15:30:00+02:00",
        status: "booked",
        details: [{ label: "Status", value: "Bokad" }],
      },
      {
        id: `booking:2026-11-12T18:00:00+01:00#${textHash("Föräldramöte")}`,
        title: "Föräldramöte",
        description: null,
        start: "2026-11-12T18:00:00+01:00",
        end: null,
        status: "unknown",
        details: [],
      },
    ],
  });
  assert.deepEqual(await run(ctx, "get_files"), {
    child,
    files: [
      {
        id: `file:${textHash(DOWNLOAD)}`,
        name: "Veckobrev v37",
        url: DOWNLOAD,
        kind: "file",
        category: "Skolan",
      },
      {
        id: `file:${textHash("https://example.test/fritids")}`,
        name: "Fritids hemsida",
        url: "https://example.test/fritids",
        kind: "link",
        category: null,
      },
    ],
  });
});

/** Which upstream answer (a path pattern) or page (an extractor name) each operation's drift breaks, and how. */
const DRIFTS: Record<string, [RegExp | string, (kind: DriftKind) => unknown]> = {
  list_children: [/\/eva\/api\/v1\/parent$/, driftedParent],
  get_schedule: [
    /\/calendar\/lessons\/week\/\d+$/,
    (kind) => driftedList(rawLessonsWeek(), DRIFT_FIELDS.lessons, kind),
  ],
  get_calendar: [
    /\/calendar\/event\/agenda$/,
    (kind) => driftedList(rawAgendaEvents(), DRIFT_FIELDS.agenda, kind),
  ],
  get_lunch_menu: [
    /\/lunchmenu\/\d+$/,
    (kind) => driftedList(rawLunch(), DRIFT_FIELDS.lunch, kind),
  ],
  get_messages: [/\/messages\/inbox$/, (kind) => driftedList(rawInbox(), DRIFT_FIELDS.inbox, kind)],
  get_assignments: [
    /\/ps\/assignments\/start-page$/,
    (kind) => driftedList(rawAssignments(), DRIFT_FIELDS.assignments, kind),
  ],
  get_news: [/\/news$/, (kind) => driftedList(rawNews(), DRIFT_FIELDS.news, kind)],
  get_subject_rooms: [
    /\/ps\/subjectroom\/\d+\/teachers$/,
    (kind) => driftedList(rawTeachers(), DRIFT_FIELDS.teachers, kind),
  ],
  get_bookings: ["extractBookings", (kind) => driftedList(pageBookings(), "when", kind)],
  get_files: ["extractFiles", (kind) => [drift(pageFiles()[0], "url", kind)]],
};

/** Break one answer or page; returns a function that repairs it. */
function breakAnswer(w: ReturnType<typeof wired>, name: string, kind: DriftKind): () => void {
  const [where, drifted] = DRIFTS[name];
  if (typeof where === "string") {
    const original = w.pages.get(where)!;
    w.pages.set(where, () => drifted(kind));
    return () => w.pages.set(where, original);
  }
  const original = [...w.answers].find(([p]) => String(p) === String(where))!;
  w.answers.set(original[0], () => drifted(kind));
  return () => w.answers.set(original[0], original[1]);
}

for (const name of TYPED) {
  for (const kind of DRIFT_KINDS) {
    test(`${name}, ${kind} field: one drift error naming the operation; nothing cached, session kept`, async () => {
      const w = wired();
      const repair = breakAnswer(w, name, kind);
      await assert.rejects(run(w.ctx, name), (e: unknown) => {
        assert.ok(e instanceof ResponseDriftError, String(e));
        assert.equal(e.operation, name);
        assert.equal(e.kind, "upstream");
        assert.doesNotMatch(
          e.message,
          /Ett|Två|Kapitel|Utflykt|Falafel|Studiedag|Läxa|Lärare|Utvecklingssamtal|Veckobrev|12345/,
        );
        return true;
      });
      assert.notEqual(w.store.load(), null, "the saved session survives drift");
      repair();
      const before = w.reads();
      await run(w.ctx, name);
      assert.ok(w.reads() > before, "the drifted answer was not cached");
    });
  }
}

test("MCP: drift is an error result with two lines, not a protocol failure, for each typed tool", async () => {
  for (const name of TYPED) {
    const w = wired();
    breakAnswer(w, name, "wrong-typed");
    const server = createMcpServer({ getContext: () => w.ctx, lang: "sv" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "drift", version: "1" });
    await Promise.all([server.connect(st), client.connect(ct)]);
    const res = await client.callTool({ name: "schoolsoft_" + name, arguments: ARGS[name] });
    assert.equal(res.isError, true, name);
    const text = (res.content as { text: string }[])[0].text;
    const [problem, next, extra] = text.split("\n");
    assert.match(problem, new RegExp(`^Error: Skolportalens svar för ${name} har ändrat form`));
    assert.match(next, /^Next: Att försöka igen hjälper inte/);
    assert.equal(extra, undefined);
    assert.equal(res.structuredContent, undefined);
    await client.close();
  }
});

test("CLI: drift exits 7 with the problem and the next step on stderr, nothing on stdout", async () => {
  for (const name of TYPED) {
    const w = wired();
    breakAnswer(w, name, "missing");
    const out: string[] = [];
    const err: string[] = [];
    const flags = Object.entries(ARGS[name]).flatMap(([k, v]) => [
      "--" + k.replace(/_/g, "-"),
      String(v),
    ]);
    const code = await runCli([name.replace(/_/g, "-"), ...flags], {
      getContext: () => w.ctx,
      stdout: (s) => out.push(s),
      stderr: (s) => err.push(s),
      env: {},
      home: mkdtempSync(join(tmpdir(), "home-")),
      platform: "linux",
      version: "test",
    });
    assert.equal(code, EXIT.UPSTREAM, name);
    assert.deepEqual(out, []);
    const lines = err.join("\n").split("\n");
    assert.equal(lines.length, 2, err.join("\n"));
    assert.match(lines[0], new RegExp(`answer for ${name} has changed shape`));
    assert.match(lines[1], /^Next: Retrying will not help/);
  }
});
