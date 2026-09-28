/** `get-assignments --format text`: the week's assignments by date, unread ones marked and emphasised. */
import type { Assignment, ChildRef } from "../../../core/index.js";
import { label } from "../labels.js";
import { cell, renderer, strong, type Line } from "../render.js";
import { table } from "../table.js";
import { stockholm } from "../time.js";

interface Assignments {
  week: number;
  year: number;
  child: ChildRef;
  assignments: Assignment[];
}

/** Stockholm date, and the time when one is given. */
function listedAt(a: Assignment): string {
  const at = stockholm(a.date);
  return at.time === null ? at.date : `${at.date} ${at.time}`;
}

function title(a: Assignment): string {
  const subtitle = a.subtitle === null ? "" : cell(a.subtitle);
  return subtitle ? `${cell(a.title)} – ${subtitle}` : cell(a.title);
}

export const assignmentsText = renderer<Assignments>((data, { lang, width }) => {
  const heading = label(lang, "assignmentsHeading", {
    week: data.week,
    year: data.year,
    child: cell(data.child.firstName),
  });
  if (data.assignments.length === 0) return [heading, "", label(lang, "noAssignments")];
  // "2026-09-10" sorts before "2026-09-10 08:00": a date-only entry comes first on its day.
  const sorted = [...data.assignments]
    .map((a) => ({ a, when: listedAt(a) }))
    .sort((x, y) => x.when.localeCompare(y.when));
  const [header, ...body] = table(
    [
      ["", label(lang, "date"), label(lang, "title"), label(lang, "status")],
      ...sorted.map(({ a, when }) => [a.read ? "" : "*", when, title(a), cell(a.submissionStatus)]),
    ],
    { flex: 2, width },
  );
  const rows: Line[] = body.map((row, i) => (sorted[i].a.read ? row : strong(row)));
  return [heading, "", header, ...rows, "", label(lang, "unreadOnlyLegend")];
});
