/**
 * Text views by operation name. A new view is one file in renderers/ and
 * one line here; the CLI program does not change. Only operations with a
 * typed `output` get a view (a test holds the two lists equal): raw portal
 * shapes are not stable enough to lay out until E4.5 types them.
 */
import type { TextRenderer } from "./render.js";
import { listChildrenText } from "./renderers/list-children.js";
import { scheduleText } from "./renderers/get-schedule.js";
import { calendarText } from "./renderers/get-calendar.js";
import { lunchText } from "./renderers/get-lunch-menu.js";
import { messagesText } from "./renderers/get-messages.js";

export const TEXT_RENDERERS: Readonly<Record<string, TextRenderer>> = {
  list_children: listChildrenText,
  get_schedule: scheduleText,
  get_calendar: calendarText,
  get_lunch_menu: lunchText,
  get_messages: messagesText,
};

export function textRenderer(operation: string): TextRenderer | undefined {
  return Object.hasOwn(TEXT_RENDERERS, operation) ? TEXT_RENDERERS[operation] : undefined;
}
