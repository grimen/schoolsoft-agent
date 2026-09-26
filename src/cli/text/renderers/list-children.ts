/** `list-children --format text`: the guardian, then one row per child. */
import type { Child } from "../../../core/index.js";
import { label } from "../labels.js";
import { cell, renderer } from "../render.js";
import { table } from "../table.js";

interface Children {
  guardianName: string;
  children: Child[];
  childInFocus: number;
}

export const listChildrenText = renderer<Children>((data, { lang, width }) => {
  const head = [label(lang, "guardian", { name: cell(data.guardianName) }), ""];
  if (data.children.length === 0) return [...head, label(lang, "noChildren")];
  const rows = [
    ["", label(lang, "id"), label(lang, "name"), label(lang, "school"), label(lang, "class")],
    ...data.children.map((c) => [
      c.id === data.childInFocus ? "*" : "",
      String(c.id),
      cell(c.firstName),
      cell(c.schoolName),
      cell(c.className),
    ]),
  ];
  return [...head, ...table(rows, { flex: 3, width }), "", label(lang, "inFocusLegend")];
});
