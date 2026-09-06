/**
 * DOM → JSON extractors for the legacy JSP pages. Each function runs INSIDE
 * the page (page.evaluate), so it must be self-contained: no imports, no
 * closures over module state. They are exercised against synthetic fixtures
 * (test/fixtures/jsp) in real Chromium by the e2e-artifact suite, and their
 * post-processing by unit tests; this file is therefore excluded from the
 * unit-coverage gate (.c8rc.json).
 *
 * Structure observed on Täby, 2026-09-06 (see docs/schoolsoft-api.md):
 *  - Kontaktlistor: #contAll_content > .h3_bold (group) + table rows with
 *    .display-info blocks: #name.heading_bold, #email a[href^=mailto], #phone,
 *    #address, #type, #role, #contact.
 *  - Ämne: #subject_menu a[href*=requestid] (subject list with the requestid
 *    the criteria page takes; subject rooms themselves come from the API).
 *  - Bokningar: #timebook_con_content .accordion-group with
 *    .accordion-heading-left > div (title), .accordion-heading-date-wide,
 *    [id^=description] (text), .inner_right_info label+div pairs.
 *  - Filer & länkar: #library_con_content table tr > td > a[href] (+ div).
 */
import type { Booking, ContactGroup, PortalFile, TablePage } from "./types.js";

const text = (el: Element | null | undefined): string =>
  (el?.textContent ?? "").replace(/\s+/g, " ").trim();

export function extractContacts(): ContactGroup[] {
  const root = document.querySelector("#contAll_content") ?? document.body;
  const groups: ContactGroup[] = [];
  let current: ContactGroup | null = null;
  const t = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
  for (const node of Array.from(root.children)) {
    if (node.classList.contains("h3_bold")) {
      current = { title: t(node), people: [] };
      groups.push(current);
      continue;
    }
    if (node.tagName !== "TABLE") continue;
    if (!current) {
      current = { title: "", people: [] };
      groups.push(current);
    }
    for (const info of Array.from(node.querySelectorAll(".display-info"))) {
      const name = t(info.querySelector("#name"));
      if (!name) continue;
      const email =
        info
          .querySelector("#email a[href^='mailto:']")
          ?.getAttribute("href")
          ?.replace(/^mailto:/, "") ||
        t(info.querySelector("#email")) ||
        undefined;
      const phone = t(info.querySelector("#phone")) || undefined;
      const role = t(info.querySelector("#role")) || t(info.querySelector("#type")) || "";
      current.people.push({ name, role, ...(email ? { email } : {}), ...(phone ? { phone } : {}) });
    }
  }
  return groups;
}

export function extractSubjectLinks(): {
  subject: string;
  url: string;
  subjectId: number | null;
}[] {
  const out: { subject: string; url: string; subjectId: number | null }[] = [];
  const seen = new Set<string>();
  for (const a of Array.from(document.querySelectorAll("#subject_menu a[href*='requestid=']"))) {
    const href = (a as HTMLAnchorElement).getAttribute("href") ?? "";
    const name = (a.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!href || !name || seen.has(href)) continue;
    seen.add(href);
    const m = /requestid=(\d+)/.exec(href);
    out.push({ subject: name, url: href, subjectId: m ? Number(m[1]) : null });
  }
  return out;
}

export function extractBookings(): Booking[] {
  const t = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
  const out: Booking[] = [];
  for (const g of Array.from(document.querySelectorAll("#timebook_con_content .accordion-group"))) {
    const title = t(g.querySelector(".accordion-heading-left > div"));
    if (!title) continue;
    const date = t(g.querySelector(".accordion-heading-date-wide"));
    const description = t(g.querySelector("[id^='description']")) || undefined;
    const info: Record<string, string> = {};
    for (const row of Array.from(g.querySelectorAll(".inner_right_info"))) {
      const label = t(row.querySelector("label"));
      const value = t(row.querySelector("div"));
      if (label) info[label] = value;
    }
    const statusText = Object.values(info).join(" ").toLowerCase();
    const status: Booking["slots"][number]["status"] = /bokad|booked/.test(statusText)
      ? "booked"
      : /stängd|closed|passerad/.test(statusText)
        ? "closed"
        : /ledig|open|tillgänglig/.test(statusText)
          ? "available"
          : "unknown";
    out.push({
      title,
      ...(description ? { description } : {}),
      slots: [{ start: date, status }],
      ...(Object.keys(info).length ? { info } : {}),
    } as Booking);
  }
  return out;
}

export function extractFiles(): PortalFile[] {
  const out: PortalFile[] = [];
  let category: string | undefined;
  const root = document.querySelector("#library_con_content") ?? document.body;
  for (const node of Array.from(root.children)) {
    if (node.classList.contains("h3_bold")) {
      category = (node.textContent ?? "").replace(/\s+/g, " ").trim();
      continue;
    }
    for (const a of Array.from(node.querySelectorAll("td > a[href]"))) {
      const url = (a as HTMLAnchorElement).getAttribute("href") ?? "";
      const name = (a.textContent ?? "").replace(/\s+/g, " ").trim();
      if (!url || !name) continue;
      const type: PortalFile["type"] = /file_download\.jsp|\.(pdf|docx?|xlsx?|pptx?)(\?|$)/i.test(
        url,
      )
        ? "file"
        : "link";
      out.push({ name, url, type, ...(category ? { category } : {}) });
    }
  }
  return out;
}

/** Text-only sanity used by tests: does the page look like a parent portal page at all? */
export function extractPageTitle(): string {
  return (document.querySelector("#content .h1")?.textContent ?? "").replace(/\s+/g, " ").trim();
}

// keep `text` referenced for tooling (it is inlined above because evaluate() needs self-contained functions)
void text;

/**
 * Generic extractor for SchoolSoft's server-rendered "longlist" pages (grades,
 * student documents, attendance report, assessment criteria): title, an
 * optional info message, and every table as headers + rows (+ first link).
 * Header row = `tr.longlistheader` / `th` / `td.header`; the section heading is
 * the nearest preceding `.h2`, `.h3_bold` or `td.header` text.
 */
export function extractTablePage(): TablePage {
  const t = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
  const content = document.querySelector("#content") ?? document.body;
  const title = t(content.querySelector(".h1"));
  const message = t(content.querySelector(".alert .message-text")) || undefined;
  const sections: TablePage["sections"] = [];
  // A heading may sit in its own one-row table (td.header) right before the list table.
  let pendingHeading: string | undefined;
  const tables = Array.from(content.querySelectorAll("table")).filter(
    (tb) => !tb.closest("#top-box") && !tb.closest("form") && !tb.closest(".h2_box"),
  );
  for (const table of tables) {
    const trs = Array.from(table.querySelectorAll(":scope > tbody > tr, :scope > tr"));
    if (trs.length === 0) continue;
    let headers: string[] = [];
    const rows: { cells: string[]; url?: string }[] = [];
    let heading: string | undefined = pendingHeading;
    pendingHeading = undefined;
    const prev = table.previousElementSibling;
    if (prev && /h3_bold|h2/.test(prev.className)) heading = t(prev);
    for (const tr of trs) {
      const cells = Array.from(tr.children).filter((c) => c.tagName === "TD" || c.tagName === "TH");
      if (cells.length === 0) continue;
      const texts = cells.map((c) => t(c));
      const isHeader =
        tr.classList.contains("longlistheader") ||
        cells.every((c) => c.tagName === "TH") ||
        (cells.length === 1 && cells[0].classList.contains("header"));
      if (isHeader) {
        if (cells.length === 1 && cells[0].classList.contains("header")) heading = texts[0];
        else headers = texts;
        continue;
      }
      if (texts.every((x) => x === "")) continue;
      const a = tr.querySelector("a[href]:not([href^='javascript'])");
      const url = a?.getAttribute("href") || undefined;
      rows.push({ cells: texts, ...(url ? { url } : {}) });
    }
    if (headers.length === 0 && rows.length === 0) {
      pendingHeading = heading;
      continue;
    }
    sections.push({ ...(heading ? { heading } : {}), headers, rows });
  }
  return { title, ...(message ? { message } : {}), sections };
}

/** What inspectPage() reports for one page: anchor hits and a structural fingerprint. */
export interface PageInspection {
  title: string;
  anchors: Record<string, number>;
  /** FNV-1a hash of the sorted set of tag#id.class skeletons under #content (ids/classes with digits dropped). */
  fingerprint: string;
  nodes: number;
}

/**
 * Structure probe used by `browser verify`, the live structure suite and
 * `make fingerprints`: counts each anchor selector and hashes the page's
 * skeleton (tags, ids and classes only, never text; hashed MUI classes and
 * numbered ids are dropped so data volume does not move the fingerprint).
 */
export function inspectPage(anchors: string[]): PageInspection {
  const t = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
  const root = document.querySelector("#content") ?? document.body;
  const counts: Record<string, number> = {};
  for (const a of anchors) counts[a] = document.querySelectorAll(a).length;
  const seen = new Set<string>();
  for (const el of Array.from(root.querySelectorAll("*"))) {
    if (el.closest("#top-box")) continue;
    const cls = Array.from(el.classList)
      .filter((c) => !/\d/.test(c))
      .sort()
      .join(".");
    const id = el.id && !/\d/.test(el.id) ? "#" + el.id : "";
    seen.add(el.tagName.toLowerCase() + id + (cls ? "." + cls : ""));
  }
  const skeleton = Array.from(seen).sort();
  const str = skeleton.join("\n");
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return {
    title: t(root.querySelector(".h1")),
    anchors: counts,
    fingerprint: h.toString(16).padStart(8, "0"),
    nodes: skeleton.length,
  };
}
