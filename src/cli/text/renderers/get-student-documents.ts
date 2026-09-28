/** `get-student-documents --format text`: current, then archived documents, newest first. */
import type { ChildRef, StudentDocument } from "../../../core/index.js";
import { label } from "../labels.js";
import { cell, renderer, type Line } from "../render.js";
import { table } from "../table.js";

interface Documents {
  child: ChildRef;
  documents: StudentDocument[];
}

export const documentsText = renderer<Documents>((data, { lang, width }) => {
  const heading = label(lang, "documentsHeading", { child: cell(data.child.firstName) });
  if (data.documents.length === 0) return [heading, "", label(lang, "noDocuments")];
  const sorted = [...data.documents].sort((a, b) => b.date.localeCompare(a.date));
  const rows = table(
    [
      ["", label(lang, "date"), label(lang, "title"), label(lang, "createdBy")],
      ...sorted.map((d) => ["", d.date, cell(d.title), cell(d.createdBy)]),
    ],
    { flex: 2, width },
  );
  const [header, ...body] = rows;
  const out: Line[] = [heading];
  for (const archived of [false, true]) {
    const lines = body.filter((_, i) => sorted[i].archived === archived);
    if (lines.length === 0) continue;
    out.push(
      "",
      label(lang, archived ? "archivedDocuments" : "currentDocuments"),
      header,
      ...lines,
    );
  }
  return out;
});
