/**
 * The capture probe (`make capture`, scripts/capture.ts): with the session
 * already saved, visit the declared targets read-only and write REDACTED
 * files to a gitignored directory for the maintainer to review. It never
 * logs in (a missing session ends the run before any navigation with the
 * usual not-authenticated error), never allows writes in the browser
 * session, never clicks or submits, and never calls a write endpoint.
 * Every dependency is injected, so the whole flow is tested offline; the
 * script only wires the real session, browser and HTTP.
 */
import type { BrowserSession } from "../../../core/browser/session.js";
import {
  AgentError,
  describeError,
  EXIT_CODE_BY_KIND,
  type Lang,
} from "../../../core/errors/index.js";
import { pageHtml } from "../portal/extractors.js";
import { extractForms } from "./forms.js";
import { Redactor } from "./redact.js";
import { hashWord } from "./scan.js";
import { CAPTURE_TARGETS, type CaptureTargets } from "./targets.js";

export interface CaptureDeps {
  /** Restore the saved session; throws the not-authenticated AgentError when there is none. */
  ensureSession(): Promise<unknown>;
  /** Names the session knows (children, guardian, school): redacted everywhere, hashed for promote. */
  knownNames(): string[];
  hasWebSession(): boolean;
  /** Align the web session's child with the app session's before the first gated page. */
  syncWebChild(): Promise<void>;
  /** Opened only after the session is established. */
  openBrowser(): BrowserSession;
  /** Cookie-authenticated JSON GET under the tenant. */
  getJson(path: string): Promise<unknown>;
  /** Today as YYYY-MM-DD (the school's time zone). */
  today(): string;
  /** Random salt for the hashed names file. */
  salt(): string;
  /** Write one file into the capture directory (relative name). */
  write(file: string, content: string): void;
  targets?: CaptureTargets;
}

export interface CaptureEntry {
  key: string;
  status: "captured" | "skipped" | "error";
  detail: string;
  file?: string;
  fixture?: string;
}

export const MANIFEST = "manifest.json";
export const HASHED_NAMES = "names.sha256.json";

const DAY = 86_400_000;
const shift = (date: string, days: number) =>
  new Date(Date.parse(date + "T00:00:00Z") + days * DAY).toISOString().slice(0, 10);
const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const reason = (e: unknown) => describeError(e, "en", "cli").message;

export async function runCapture(d: CaptureDeps): Promise<CaptureEntry[]> {
  await d.ensureSession();
  const targets = d.targets ?? CAPTURE_TARGETS;
  const r = new Redactor({ knownNames: d.knownNames() });
  const entries: CaptureEntry[] = [];
  const save = (key: string, fixture: string, content: string, detail: string) => {
    const file = basename(fixture);
    d.write(file, content);
    entries.push({ key, status: "captured", detail, file, fixture });
  };

  const browser = d.openBrowser();
  let synced = false;
  try {
    for (const p of targets.pages) {
      if (p.web && !d.hasWebSession()) {
        entries.push({
          key: p.key,
          status: "skipped",
          detail: "needs the web login (make login-web)",
        });
        continue;
      }
      try {
        if (p.web && !synced) {
          synced = true;
          await d.syncWebChild();
        }
        const html = await browser.withPage(
          async (page) => {
            await page.goto(p.path);
            return page.evaluate(pageHtml);
          },
          { web: p.web },
        );
        if (p.kind === "forms") {
          const forms = extractForms(html, r);
          const fields = forms.reduce((n, f) => n + f.fields.length, 0);
          save(
            p.key,
            p.fixture,
            JSON.stringify(forms, null, 2) + "\n",
            `${forms.length} form(s), ${fields} field(s)`,
          );
        } else {
          const page = r.html(html);
          save(p.key, p.fixture, page, `${page.length} characters of redacted HTML`);
        }
      } catch (e) {
        entries.push({ key: p.key, status: "error", detail: reason(e) });
      }
    }
  } finally {
    await browser.close();
  }

  const a = targets.agenda;
  try {
    let found: { data: unknown[]; start: string; end: string } | null = null;
    for (const [before, after] of a.windows) {
      const start = shift(d.today(), -before);
      const end = shift(d.today(), after);
      const data = await d.getJson(`${a.path}?start_date=${start}&end_date=${end}`);
      if (!Array.isArray(data))
        throw new AgentError({ kind: "upstream", key: "calendar_response", hint: "retry" });
      found = { data, start, end };
      if (data.length > 0) break;
    }
    const { data, start, end } = found!;
    save(
      a.key,
      a.fixture,
      JSON.stringify(r.json(data), null, 2) + "\n",
      `${data.length} event(s) between ${start} and ${end}`,
    );
  } catch (e) {
    entries.push({ key: a.key, status: "error", detail: reason(e) });
  }

  const captured = entries.filter((e) => e.status === "captured");
  d.write(
    MANIFEST,
    JSON.stringify(
      {
        note: "Redacted captures. Review every file before `make capture-promote`; nothing here is committed.",
        capturedOn: d.today(),
        files: captured.map((e) => ({ file: e.file, fixture: e.fixture })),
      },
      null,
      2,
    ) + "\n",
  );
  const salt = d.salt();
  d.write(
    HASHED_NAMES,
    JSON.stringify({ salt, hashes: r.knownWords().map((w) => hashWord(salt, w)) }) + "\n",
  );
  return entries;
}

export interface CaptureIo {
  out(line: string): void;
  err(line: string): void;
}

/** The command: a notice, the run, one line per target; errors rendered like the CLI's. */
export async function captureMain(
  load: () => CaptureDeps,
  io: CaptureIo,
  captureDir: string,
  lang: Lang = "en",
): Promise<number> {
  io.out(
    "Capture probe: read-only, redacted, written to " +
      captureDir +
      " (gitignored). Nothing reaches git until you have reviewed the files and run make capture-promote.",
  );
  try {
    const entries = await runCapture(load());
    for (const e of entries) io.out(`${e.key.padEnd(12)} ${e.status.padEnd(8)} ${e.detail}`);
    io.out(
      `Next: read every file in ${captureDir} yourself (names, subjects, free text must be gone), ` +
        "then run make capture-promote. The promote step checks again and refuses anything that still looks personal.",
    );
    return entries.some((e) => e.status === "error") ? EXIT_CODE_BY_KIND.upstream : 0;
  } catch (e) {
    const d = describeError(e, lang, "cli");
    io.err(d.message);
    if (d.hint) io.err(`${lang === "sv" ? "Nästa steg" : "Next"}: ${d.hint}`);
    return d.exitCode;
  }
}
