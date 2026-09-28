/** `get-files --format text`: files and links under their category, in the portal's order. */
import type { ChildRef, SharedFile } from "../../../core/index.js";
import { label } from "../labels.js";
import { cell, renderer, type Line } from "../render.js";
import { table } from "../table.js";
import { clean } from "../terminal.js";

interface Files {
  child: ChildRef;
  files: SharedFile[];
}

export const filesText = renderer<Files>((data, { lang, width }) => {
  const heading = label(lang, "filesHeading", { child: cell(data.child.firstName) });
  if (data.files.length === 0) return [heading, "", label(lang, "noFiles")];
  const rows = table(
    data.files.map((f) => [
      "",
      cell(f.name),
      label(lang, f.kind === "file" ? "fileKind" : "linkKind"),
      cell(f.url),
    ]),
    { flex: 3, width },
  );
  const groups = new Map<string, string[]>();
  data.files.forEach((f, i) => {
    const category = (f.category === null ? "" : clean(f.category)) || label(lang, "uncategorized");
    groups.set(category, [...(groups.get(category) ?? []), rows[i]]);
  });
  const out: Line[] = [heading];
  for (const [category, lines] of groups) out.push("", category, ...lines);
  return out;
});
