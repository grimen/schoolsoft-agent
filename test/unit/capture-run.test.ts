/**
 * The capture flow with every dependency faked against its port: the
 * session is checked before anything else (no session = the usual
 * not-authenticated error, no browser, no request, no file), pages are
 * visited read-only, the gated page needs the web login, the agenda widens
 * its window until it finds events, and only redacted content is written.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  captureMain,
  HASHED_NAMES,
  MANIFEST,
  runCapture,
  type CaptureDeps,
} from "../../src/providers/schoolsoft/capture/capture.js";
import { CAPTURE_TARGETS } from "../../src/providers/schoolsoft/capture/targets.js";
import { hashWord, scanForPersonalData } from "../../src/providers/schoolsoft/capture/scan.js";
import { pageHtml } from "../../src/providers/schoolsoft/portal/extractors.js";
import type {
  BrowserSession,
  PortalPage,
  WithPageOptions,
} from "../../src/core/browser/session.js";
import { AgentError, describeError, EXIT_CODE_BY_KIND } from "../../src/core/errors/index.js";
import { makeContext } from "../helpers/fakes.js";

const FORM_PAGE = (name: string) =>
  `<div class="h1">Frånvaroanmälan</div><div id="top-box">Bo Exempelsson</div>
<form name="${name}" action="save.jsp" method="post"><input name="date" value="2026-09-26" required>
<textarea name="text">Ada är sjuk</textarea><input type="submit" value="Skicka"></form>`;

const PAGES: Record<string, string> = {
  "/jsp/student/right_student_absence.jsp": FORM_PAGE("absence"),
  "/jsp/student/right_student_studentleave.jsp": FORM_PAGE("leave"),
  "/jsp/student/right_student_message.jsp": FORM_PAGE("message"),
  "/jsp/student/right_student_lesson_status.jsp":
    "<table><tr><td>Matematik</td><td>Närvarande</td><td>Ada Exempelsson</td></tr></table>",
};

class FakeBrowser implements BrowserSession {
  visits: { path: string; options: WithPageOptions }[] = [];
  closed = 0;
  constructor(private readonly failOn?: string) {}
  async withPage<T>(fn: (page: PortalPage) => Promise<T>, options: WithPageOptions = {}) {
    let current = "";
    const page: PortalPage = {
      goto: async (path) => {
        if (path === this.failOn) throw new Error("navigation failed");
        current = path;
        this.visits.push({ path, options });
      },
      evaluate: async <R, A>(fn2: (arg: A) => R) => {
        assert.equal(fn2, pageHtml, "only the whole-page extractor runs");
        return PAGES[current] as R;
      },
      url: () => "https://portal.example" + current,
      waitForJson: async () => ({}) as never,
    };
    return fn(page);
  }
  async close() {
    this.closed++;
  }
}

function deps(over: Partial<CaptureDeps> & { browser?: FakeBrowser; agenda?: unknown[][] } = {}) {
  const calls: string[] = [];
  const files = new Map<string, string>();
  const browser = over.browser ?? new FakeBrowser();
  const agenda = over.agenda ?? [
    [],
    [
      {
        eventId: 90210,
        name: "Utvecklingssamtal Ada",
        startDate: "2026-10-01",
        endDate: "2026-10-01",
        allDay: true,
      },
    ],
  ];
  const d: CaptureDeps = {
    ensureSession: async () => void calls.push("ensureSession"),
    knownNames: () => ["Ada Exempelsson", "Bo Exempelsson"],
    hasWebSession: () => true,
    syncWebChild: async () => void calls.push("syncWebChild"),
    openBrowser: () => {
      calls.push("openBrowser");
      return browser;
    },
    getJson: async (path) => {
      calls.push(path);
      return agenda.shift();
    },
    today: () => "2026-09-26",
    salt: () => "salt",
    write: (file, content) => void files.set(file, content),
    ...over,
  };
  return { d, calls, files, browser };
}

test("captures the three forms, the gated page and the first non-empty agenda window, redacted", async () => {
  const { d, calls, files, browser } = deps();
  const entries = await runCapture(d);
  assert.deepEqual(
    entries.map((e) => [e.key, e.status, e.detail]),
    [
      ["absenceForm", "captured", "1 form(s), 3 field(s)"],
      ["leaveForm", "captured", "1 form(s), 3 field(s)"],
      ["messageForm", "captured", "1 form(s), 3 field(s)"],
      [
        "overview",
        "captured",
        `${files.get("right_student_lesson_status.jsp.html")!.length} characters of redacted HTML`,
      ],
      ["eventAgenda", "captured", "1 event(s) between 2026-05-29 and 2027-05-24"],
    ],
  );
  assert.deepEqual(calls, [
    "ensureSession",
    "openBrowser",
    "syncWebChild",
    `${CAPTURE_TARGETS.agenda.path}?start_date=2026-09-19&end_date=2026-11-25`,
    `${CAPTURE_TARGETS.agenda.path}?start_date=2026-05-29&end_date=2027-05-24`,
  ]);
  assert.deepEqual(
    browser.visits.map((v) => [v.path, v.options]),
    CAPTURE_TARGETS.pages.map((p) => [p.path, { web: p.web }]),
    "never allowWrites, never an allowed non-GET",
  );
  assert.equal(browser.closed, 1);
  assert.deepEqual(
    [...files.keys()],
    [
      "right_student_absence.jsp.json",
      "right_student_studentleave.jsp.json",
      "right_student_message.jsp.json",
      "right_student_lesson_status.jsp.html",
      "calendar-event-agenda.json",
      MANIFEST,
      HASHED_NAMES,
    ],
  );
  const manifest = JSON.parse(files.get(MANIFEST)!);
  assert.deepEqual(
    manifest.files.map((f: { fixture: string }) => f.fixture),
    [...CAPTURE_TARGETS.pages.map((p) => p.fixture), CAPTURE_TARGETS.agenda.fixture],
  );
  assert.match(manifest.note, /Review every file/);
  assert.deepEqual(JSON.parse(files.get(HASHED_NAMES)!), {
    salt: "salt",
    hashes: ["ada", "exempelsson", "bo"].map((w) => hashWord("salt", w)),
  });
  assert.deepEqual(JSON.parse(files.get("calendar-event-agenda.json")!), [
    {
      eventId: 1001,
      name: "[text 3]",
      startDate: "2026-10-01",
      endDate: "2026-10-01",
      allDay: true,
    },
  ]);
  const hashed = JSON.parse(files.get(HASHED_NAMES)!);
  for (const [name, content] of files) {
    if (name === HASHED_NAMES) continue;
    if (name !== MANIFEST)
      assert.ok(!/Ada|Exempelsson|Matematik|sjuk|2026-09-26/.test(content), `${name} is redacted`);
    assert.deepEqual(
      scanForPersonalData(content, { words: [], hashed }),
      [],
      `${name} passes promote`,
    );
  }
});

test("without the web login the gated page is skipped and the web child is never synced", async () => {
  const { d, calls, browser } = deps({ hasWebSession: () => false });
  const entries = await runCapture(d);
  assert.deepEqual(entries[3], {
    key: "overview",
    status: "skipped",
    detail: "needs the web login (make login-web)",
  });
  assert.ok(!calls.includes("syncWebChild"));
  assert.equal(browser.visits.length, 3);
});

test("a failing page or agenda is reported and the rest still runs; an empty agenda is kept", async () => {
  const failing = deps({
    browser: new FakeBrowser("/jsp/student/right_student_message.jsp"),
    agenda: [{} as never],
  });
  const entries = await runCapture(failing.d);
  assert.deepEqual(entries[2], {
    key: "messageForm",
    status: "error",
    detail: describeError(new Error("navigation failed"), "en", "cli").message,
  });
  assert.equal(entries[3].status, "captured");
  assert.equal(entries[4].status, "error");
  assert.equal(JSON.parse(failing.files.get(MANIFEST)!).files.length, 3);

  const empty = deps({ agenda: [[], []] });
  const out = await runCapture(empty.d);
  assert.equal(out[4].detail, "0 event(s) between 2026-05-29 and 2027-05-24");
  assert.equal(empty.files.get("calendar-event-agenda.json"), "[]\n");
});

test("captureMain: notice first, one line per target, exit code by outcome", async () => {
  const lines: string[] = [];
  const io = { out: (l: string) => lines.push(l), err: (l: string) => lines.push("ERR " + l) };
  assert.equal(await captureMain(() => deps().d, io, "/x/.captures"), 0);
  assert.match(lines[0], /read-only, redacted, written to \/x\/\.captures \(gitignored\)/);
  assert.match(lines[1], /^absenceForm +captured/);
  assert.match(lines.at(-1)!, /make capture-promote/);

  const failing = deps({ agenda: [{} as never] });
  assert.equal(await captureMain(() => failing.d, io, "d"), EXIT_CODE_BY_KIND.upstream);
});

test("no saved session: the not-authenticated error and hint, before any browser, request or file", async () => {
  const { manager } = makeContext();
  for (const lang of ["en", "sv"] as const) {
    const { d, calls, files } = deps({ ensureSession: () => manager.ensureSession() });
    const out: string[] = [];
    const err: string[] = [];
    const code = await captureMain(
      () => d,
      { out: (l) => out.push(l), err: (l) => err.push(l) },
      "d",
      lang,
    );
    const expected = await manager
      .ensureSession()
      .catch((e: unknown) => describeError(e, lang, "cli"));
    assert.equal(code, EXIT_CODE_BY_KIND.not_authenticated);
    assert.deepEqual(err, [
      (expected as { message: string }).message,
      `${lang === "sv" ? "Nästa steg" : "Next"}: ${(expected as { hint: string }).hint}`,
    ]);
    assert.deepEqual(calls, [], "no browser opened, no request made");
    assert.equal(files.size, 0);
    assert.equal(out.length, 1, "only the notice");
  }
});

test("an error without a hint prints one line; configuration errors from loading are rendered too", async () => {
  const err: string[] = [];
  const io = { out: () => {}, err: (l: string) => err.push(l) };
  const code = await captureMain(
    () => {
      throw new AgentError({
        kind: "upstream",
        key: "response_drift",
        params: { operation: "o", detail: "d" },
      });
    },
    io,
    "d",
  );
  assert.equal(code, EXIT_CODE_BY_KIND.upstream);
  assert.equal(err.length, 1);
});
