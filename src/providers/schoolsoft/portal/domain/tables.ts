/**
 * The GDPR-gated pages (browser, web session), read with the generic table
 * extractor. What the recorded pages prove is a table, so most of them map
 * to a TablePage as the page shows it. The student documents list has fixed
 * columns ("Rubrik / Skapad av / Datum", observed live 2026-09-06) and rows
 * that link to the document by `requestid`, so it maps to StudentDocuments;
 * its date format is assumed from the synthetic fixture (see the E4.5 spec).
 */
import { z } from "zod";
import type { StudentDocument, TablePage } from "../../../../core/domain/schemas.js";
import type { Capability } from "../../../../core/portal/types.js";
import { toLocalDate } from "../../../../core/domain/time.js";
import { ResponseDriftError } from "../../../../core/errors/index.js";
import { optionalText, parseUpstream } from "./parse.js";

const rawRow = z.object({ cells: z.array(z.string()), url: optionalText });

const rawTablePage = z.object({
  title: z.string(),
  message: optionalText,
  sections: z.array(
    z.object({ heading: optionalText, headers: z.array(z.string()), rows: z.array(rawRow) }),
  ),
});

export function toTablePage(data: unknown, capability: Capability): TablePage {
  const page = parseUpstream(rawTablePage, data, capability);
  return {
    title: page.title,
    message: page.message,
    sections: page.sections.map((s) => ({
      heading: s.heading,
      headers: s.headers,
      rows: s.rows.map((r) => ({ cells: r.cells, link: r.url })),
    })),
  };
}

/** Column headings of the documents list, lower case, as observed. */
const COLUMNS = ["rubrik", "skapad av", "datum"] as const;
const REQUEST_ID = /[?&]requestid=(\d+)/;

const date = z.string().transform((value, ctx) => {
  const parsed = toLocalDate(value);
  if (parsed === null) {
    ctx.addIssue({ code: "custom", message: "not a date" });
    return z.NEVER;
  }
  return parsed;
});

const rawDocuments = z.array(
  z.object({
    title: z.string().trim().min(1),
    createdBy: optionalText,
    date,
    link: z.string().regex(REQUEST_ID),
  }),
);

/**
 * Every table with rows must be a documents list (its three columns found by
 * heading); a table without rows (the empty "current documents" box, a
 * heading's own table) holds none. Rows are then checked together.
 */
export function toStudentDocuments(data: unknown): StudentDocument[] {
  const page = toTablePage(data, "getStudentDocuments");
  const rows = page.sections.flatMap((section, i) => {
    if (section.rows.length === 0) return [];
    const headers = section.headers.map((h) => h.trim().toLowerCase());
    const [title, createdBy, when] = COLUMNS.map((c) => headers.indexOf(c));
    if (Math.min(title, createdBy, when) === -1)
      throw new ResponseDriftError(
        "getStudentDocuments",
        `sections.${i}.headers not the documents columns`,
      );
    return section.rows.map((r) => ({
      title: r.cells[title],
      createdBy: r.cells[createdBy],
      date: r.cells[when],
      link: r.link,
    }));
  });
  return parseUpstream(rawDocuments, rows, "getStudentDocuments").map((d) => ({
    id: `document:${REQUEST_ID.exec(d.link)![1]}`,
    title: d.title,
    createdBy: d.createdBy,
    date: d.date,
    archived: /[?&]archive=1(&|$)/.test(d.link),
    link: d.link,
  }));
}
