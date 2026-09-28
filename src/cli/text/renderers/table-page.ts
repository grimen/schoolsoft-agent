/**
 * `--format text` for the gated pages read as tables (grades, unreported
 * absence, attendance report, assessment criteria): the page's own title,
 * its notice, then each table with its heading, laid out as the page words it.
 */
import type { ChildRef, TablePage } from "../../../core/index.js";
import { label } from "../labels.js";
import { cell, renderer, type Line } from "../render.js";
import { table } from "../table.js";
import { displayWidth } from "../terminal.js";

interface Page {
  child: ChildRef;
  page: TablePage;
}

/** One table: every row as wide as the widest, the widest column the one that gives way. */
function section(headers: string[], rows: string[][], width: number | undefined): string[] {
  const all = headers.length > 0 ? [headers, ...rows] : rows;
  const columns = Math.max(...all.map((r) => r.length));
  const padded = all.map((r) => Array.from({ length: columns }, (_, i) => cell(r[i] ?? null)));
  const widths = Array.from({ length: columns }, (_, i) =>
    Math.max(...padded.map((r) => displayWidth(r[i]))),
  );
  return table(padded, { flex: widths.indexOf(Math.max(...widths)), width });
}

export const tablePageText = renderer<Page>((data, { lang, width }) => {
  const out: Line[] = [
    label(lang, "pageHeading", { title: cell(data.page.title), child: cell(data.child.firstName) }),
  ];
  if (data.page.message !== null) out.push("", cell(data.page.message));
  const sections = data.page.sections.filter((s) => s.headers.length > 0 || s.rows.length > 0);
  for (const s of sections) {
    out.push("");
    if (s.heading !== null) out.push(cell(s.heading));
    out.push(
      ...section(
        s.headers,
        s.rows.map((r) => r.cells),
        width,
      ),
    );
  }
  if (data.page.message === null && sections.length === 0)
    out.push("", label(lang, "nothingToShow"));
  return out;
});
