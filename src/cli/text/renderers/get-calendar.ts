/**
 * `get-calendar --format text`: an agenda by date. All-day and date-only
 * entries come first under their date, then timed entries by start.
 */
import type { CalendarEvent, ChildRef } from "../../../core/index.js";
import { label } from "../labels.js";
import { cell, renderer } from "../render.js";
import { byDate, dayBlocks, untilSuffix } from "../days.js";
import { table } from "../table.js";
import { stockholm } from "../time.js";

interface Calendar {
  startDate: string;
  endDate: string;
  child: ChildRef;
  events: CalendarEvent[];
}

export const calendarText = renderer<Calendar>((data, ctx) => {
  const { lang, width } = ctx;
  const heading = label(lang, "calendarHeading", {
    start: data.startDate,
    end: data.endDate,
    child: cell(data.child.firstName),
  });
  if (data.events.length === 0) return [heading, "", label(lang, "noEvents")];
  const entries = data.events
    .map((e) => {
      const start = stockholm(e.start);
      const end = stockholm(e.end);
      const allDay = e.allDay || start.time === null || end.time === null;
      return { event: e, start, end, allDay, at: Date.parse(e.start) };
    })
    .sort(
      (a, b) =>
        a.start.date.localeCompare(b.start.date) ||
        Number(b.allDay) - Number(a.allDay) ||
        a.at - b.at,
    );
  const rows = table(
    entries.map(({ event, start, end, allDay }) => [
      "",
      allDay ? label(lang, "allDay") : `${start.time}–${end.time}`,
      cell(event.title) + untilSuffix(lang, start.date, end.date),
      cell(event.location),
    ]),
    { flex: 2, width },
  );
  const days = byDate(
    entries.map((e) => e.start.date),
    rows,
  );
  return [heading, "", ...dayBlocks(ctx, days)];
});
