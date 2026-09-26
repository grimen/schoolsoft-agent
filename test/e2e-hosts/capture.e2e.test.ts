/**
 * The capture flow in REAL Chromium, through the production
 * PlaywrightSession, against synthetic pages (test/fixtures/capture) on a
 * file:// origin: the in-page pageHtml extractor, the read-only guard and
 * the redaction of what a browser actually serialises. Hermetic: no
 * SchoolSoft, no session. Skips when Chromium is not installed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { browserStatus } from "../../src/core/browser/install.js";
import { PlaywrightSession } from "../../src/core/browser/playwright.js";
import { CountingBudget } from "../helpers/budget.js";
import { HASHED_NAMES, runCapture } from "../../src/providers/schoolsoft/capture/capture.js";
import { scanForPersonalData } from "../../src/providers/schoolsoft/capture/scan.js";

const fixtures = join(process.cwd(), "test", "fixtures", "capture");
const status = await browserStatus({ kind: "chromium" });
const skip = status.ready ? false : `headless browser not installed (${status.hint})`;

test(
  "capture in Chromium: form structure and a redacted gated page from synthetic pages",
  { skip },
  async () => {
    const files = new Map<string, string>();
    const browser = new PlaywrightSession({
      budget: new CountingBudget(),
      school: "",
      cookieHeader: () => "x=1",
      // file:// ignores cookies; the gated page only needs web cookies to be present.
      webCookies: () => [
        { name: "w", value: "1", domain: "", path: "/", expires: -1, httpOnly: true, secure: true },
      ],
      origin: pathToFileURL(fixtures).toString().replace(/\/$/, ""),
    });
    const entries = await runCapture({
      ensureSession: async () => {},
      knownNames: () => ["Ada Exempelsson", "Bo Exempelsson"],
      hasWebSession: () => true,
      syncWebChild: async () => {},
      openBrowser: () => browser,
      getJson: async () => [],
      today: () => "2026-09-26",
      salt: () => "salt",
      write: (file, content) => void files.set(file, content),
      targets: {
        pages: [
          {
            key: "absenceForm",
            path: "/absence-form.html",
            web: false,
            kind: "forms",
            fixture: "test/fixtures/forms/a.json",
          },
          {
            key: "overview",
            path: "/overview.html",
            web: true,
            kind: "html",
            fixture: "test/fixtures/jsp/o.html",
          },
        ],
        agenda: {
          key: "eventAgenda",
          path: "/agenda",
          fixture: "test/fixtures/api/e.json",
          windows: [[0, 1]],
        },
      },
    });
    assert.deepEqual(
      entries.map((e) => e.status),
      ["captured", "captured", "captured"],
    );
    const [form] = JSON.parse(files.get("a.json")!);
    assert.equal(form.method, "post");
    assert.equal(form.action, "right_student_absence.jsp?studentid=1001");
    assert.deepEqual(
      form.fields.map((f: { name: string; type: string }) => `${f.name ?? ""}:${f.type}`),
      ["token:hidden", "from:text", "reason:select", "comment:textarea", ":submit"],
    );
    const overview = files.get("o.html")!;
    assert.match(overview, /<td>Närvarande<\/td>/);
    assert.match(overview, /<td>2026-09-21<\/td>/);
    for (const [name, content] of files) {
      if (name === HASHED_NAMES) continue; // salted hashes, never promoted
      assert.ok(!/Exempelsson|Matematik|0f9e8d7c|4401|hemma/.test(content));
      assert.deepEqual(
        scanForPersonalData(content, { words: ["Ada Exempelsson", "Bo Exempelsson"] }),
        [],
      );
    }
  },
);
