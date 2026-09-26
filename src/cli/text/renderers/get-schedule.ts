/** `get-schedule --format text`: the week, one block per day, lessons in order. */
import type { ChildRef, Lesson } from "../../../core/index.js";
import { label } from "../labels.js";
import { cell, renderer } from "../render.js";
import { byDate, dayBlocks, untilSuffix } from "../days.js";
import { table } from "../table.js";
import { stockholm } from "../time.js";

interface Schedule {
  week: number;
  child: ChildRef;
  lessons: Lesson[];
}

export const scheduleText = renderer<Schedule>((data, ctx) => {
  const { lang, width } = ctx;
  const heading = label(lang, "scheduleHeading", {
    week: data.week,
    child: cell(data.child.firstName),
  });
  if (data.lessons.length === 0) return [heading, "", label(lang, "noLessons")];
  const lessons = [...data.lessons]
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
    .map((l) => ({ lesson: l, start: stockholm(l.start), end: stockholm(l.end) }));
  const rows = table(
    lessons.map(({ lesson, start, end }) => [
      "",
      `${start.time}–${end.time}`,
      cell(lesson.title) + untilSuffix(lang, start.date, end.date),
      cell(lesson.room),
    ]),
    { flex: 2, width },
  );
  const days = byDate(
    lessons.map((l) => l.start.date),
    rows,
  );
  return [heading, "", ...dayBlocks(ctx, days)];
});
