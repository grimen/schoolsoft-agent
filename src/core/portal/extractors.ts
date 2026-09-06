/**
 * DOM → JSON extractors for the legacy JSP pages. Each function runs INSIDE
 * the page (page.evaluate), so it must be self-contained: no imports, no
 * closures over module state. They are exercised against synthetic fixtures
 * (test/fixtures/jsp) in real Chromium by the e2e-artifact suite, and their
 * post-processing by unit tests.
 *
 * Structure observed on Täby, 2026-09-06 (see docs/schoolsoft-api.md):
 *  - Kontaktlistor: #contAll_content > .h3_bold (group) + table rows with
 *    .display-info blocks: #name.heading_bold, #email a[href^=mailto], #phone,
 *    #address, #type, #role, #contact.
 *  - Ämne: #subject_menu a[href*=requestid] (subject list); a subject page
 *    has #teacher_con_content .display-info (#name, #type, #email a).
 *  - Bokningar: #timebook_con_content .accordion-group with
 *    .accordion-heading-left > div (title), .accordion-heading-date-wide,
 *    [id^=description] (text), .inner_right_info label+div pairs.
 *  - Filer & länkar: #library_con_content table tr > td > a[href] (+ div).
 */
import type { Booking, ContactGroup, PortalFile } from "./types.js";

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

export function extractSubjectLinks(): { subject: string; url: string }[] {
  const out: { subject: string; url: string }[] = [];
  const seen = new Set<string>();
  for (const a of Array.from(document.querySelectorAll("#subject_menu a[href*='requestid=']"))) {
    const href = (a as HTMLAnchorElement).getAttribute("href") ?? "";
    const name = (a.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!href || !name || seen.has(href)) continue;
    seen.add(href);
    out.push({ subject: name, url: href });
  }
  return out;
}

export function extractSubjectTeachers(): string[] {
  const out: string[] = [];
  for (const info of Array.from(document.querySelectorAll("#teacher_con_content .display-info"))) {
    const name = (info.querySelector("#name")?.textContent ?? "").replace(/\s+/g, " ").trim();
    if (name) out.push(name);
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
