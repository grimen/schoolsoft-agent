/** `get-bookings --format text`: one row per booking in time order, with its status in words. */
import type { Booking, ChildRef, Lang } from "../../../core/index.js";
import { label, type LabelKey } from "../labels.js";
import { cell, renderer } from "../render.js";
import { table } from "../table.js";
import { stockholm } from "../time.js";

interface Bookings {
  child: ChildRef;
  bookings: Booking[];
}

const STATUS: Record<Booking["status"], LabelKey | null> = {
  available: "bookingAvailable",
  booked: "bookingBooked",
  closed: "bookingClosed",
  unknown: null,
};

function when(b: Booking): string {
  const start = stockholm(b.start);
  if (start.time === null) return start.date;
  const end = b.end === null ? null : stockholm(b.end);
  return end === null ? `${start.date} ${start.time}` : `${start.date} ${start.time}–${end.time}`;
}

function status(lang: Lang, b: Booking): string {
  const key = STATUS[b.status];
  return key === null ? cell(null) : label(lang, key);
}

export const bookingsText = renderer<Bookings>((data, { lang, width }) => {
  const heading = label(lang, "bookingsHeading", { child: cell(data.child.firstName) });
  if (data.bookings.length === 0) return [heading, "", label(lang, "noBookings")];
  const sorted = [...data.bookings].sort((a, b) => when(a).localeCompare(when(b)));
  const rows = table(
    [
      [label(lang, "when"), label(lang, "title"), label(lang, "status")],
      ...sorted.map((b) => [when(b), cell(b.title), status(lang, b)]),
    ],
    { flex: 1, width },
  );
  return [heading, "", ...rows];
});
