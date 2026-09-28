/**
 * Text views by operation name. A new view is one file in renderers/ and
 * one line here; the CLI program does not change. Only operations with a
 * typed `output` get a view (a test holds the two lists equal): raw portal
 * shapes are not stable enough to lay out.
 */
import type { TextRenderer } from "./render.js";
import { listChildrenText } from "./renderers/list-children.js";
import { scheduleText } from "./renderers/get-schedule.js";
import { calendarText } from "./renderers/get-calendar.js";
import { lunchText } from "./renderers/get-lunch-menu.js";
import { messagesText } from "./renderers/get-messages.js";
import { assignmentsText } from "./renderers/get-assignments.js";
import { newsText } from "./renderers/get-news.js";
import { subjectRoomsText } from "./renderers/get-subject-rooms.js";
import { bookingsText } from "./renderers/get-bookings.js";
import { filesText } from "./renderers/get-files.js";

export const TEXT_RENDERERS: Readonly<Record<string, TextRenderer>> = {
  list_children: listChildrenText,
  get_schedule: scheduleText,
  get_calendar: calendarText,
  get_lunch_menu: lunchText,
  get_messages: messagesText,
  get_assignments: assignmentsText,
  get_news: newsText,
  get_subject_rooms: subjectRoomsText,
  get_bookings: bookingsText,
  get_files: filesText,
};

export function textRenderer(operation: string): TextRenderer | undefined {
  return Object.hasOwn(TEXT_RENDERERS, operation) ? TEXT_RENDERERS[operation] : undefined;
}
