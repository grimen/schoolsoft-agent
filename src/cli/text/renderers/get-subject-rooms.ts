/** `get-subject-rooms --format text`: one row per subject with its groups and teachers. */
import type { ChildRef, SubjectRoom } from "../../../core/index.js";
import { label } from "../labels.js";
import { cell, renderer } from "../render.js";
import { table } from "../table.js";

interface Rooms {
  child: ChildRef;
  rooms: SubjectRoom[];
}

const list = (items: string[]) => cell(items.map((i) => cell(i)).join(", "));

export const subjectRoomsText = renderer<Rooms>((data, { lang, width }) => {
  const heading = label(lang, "subjectRoomsHeading", { child: cell(data.child.firstName) });
  if (data.rooms.length === 0) return [heading, "", label(lang, "noSubjectRooms")];
  const rows = table(
    [
      [label(lang, "subject"), label(lang, "groups"), label(lang, "teachers")],
      ...data.rooms.map((r) => [cell(r.name), list(r.groups), list(r.teachers.map((t) => t.name))]),
    ],
    { flex: 2, width },
  );
  return [heading, "", ...rows];
});
