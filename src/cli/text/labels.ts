/**
 * Every word the text views print, in English and Swedish, in one table so
 * a missing translation is one failing test rather than a mixed-language
 * screen. Templates take their values as parameters; the language comes
 * from core's `detectLang`, the same one error messages use.
 */
import type { Lang } from "../../core/index.js";

type Text = string | ((p: Record<string, string | number>) => string);

export const LABELS = {
  weekday1: { en: "Mon", sv: "mån" },
  weekday2: { en: "Tue", sv: "tis" },
  weekday3: { en: "Wed", sv: "ons" },
  weekday4: { en: "Thu", sv: "tor" },
  weekday5: { en: "Fri", sv: "fre" },
  weekday6: { en: "Sat", sv: "lör" },
  weekday7: { en: "Sun", sv: "sön" },
  today: { en: "today", sv: "idag" },
  id: { en: "ID", sv: "ID" },
  name: { en: "Name", sv: "Namn" },
  school: { en: "School", sv: "Skola" },
  class: { en: "Class", sv: "Klass" },
  date: { en: "Date", sv: "Datum" },
  from: { en: "From", sv: "Från" },
  subject: { en: "Subject", sv: "Ämne" },
  allDay: { en: "All day", sv: "Heldag" },
  until: { en: (p) => `until ${p.date}`, sv: (p) => `till ${p.date}` },
  guardian: { en: (p) => `Guardian: ${p.name}`, sv: (p) => `Vårdnadshavare: ${p.name}` },
  inFocusLegend: { en: "* child in focus", sv: "* barnet i fokus" },
  noChildren: { en: "No children on this account.", sv: "Inga barn på det här kontot." },
  scheduleHeading: {
    en: (p) => `Week ${p.week} · ${p.child}`,
    sv: (p) => `Vecka ${p.week} · ${p.child}`,
  },
  noLessons: { en: "No lessons this week.", sv: "Inga lektioner den här veckan." },
  calendarHeading: {
    en: (p) => `Calendar ${p.start} – ${p.end} · ${p.child}`,
    sv: (p) => `Kalender ${p.start} – ${p.end} · ${p.child}`,
  },
  noEvents: {
    en: "Nothing in the calendar for this period.",
    sv: "Inget i kalendern för den här perioden.",
  },
  lunchHeading: {
    en: (p) => `Lunch, week ${p.week} ${p.year} · ${p.child}`,
    sv: (p) => `Lunch, vecka ${p.week} ${p.year} · ${p.child}`,
  },
  noMenu: { en: "No menu", sv: "Ingen meny" },
  noLunchWeek: { en: "No lunch menu for this week.", sv: "Ingen lunchmeny den här veckan." },
  inboxHeading: {
    en: (p) => `Inbox (${p.unread} unread)`,
    sv: (p) => `Inkorg (${p.unread} olästa)`,
  },
  unreadLegend: {
    en: "* unread · + attachment",
    sv: "* oläst · + bilaga",
  },
  noMessages: { en: "No messages.", sv: "Inga meddelanden." },
  fallback: {
    en: (p) => `Text view is not available for ${p.command} yet; showing JSON.`,
    sv: (p) => `Textvy finns inte för ${p.command} än; visar JSON.`,
  },
} satisfies Record<string, Record<Lang, Text>>;

export type LabelKey = keyof typeof LABELS;

/** A label in a language, with its template parameters filled in. */
export function label(
  lang: Lang,
  key: LabelKey,
  params: Record<string, string | number> = {},
): string {
  const text: Text = LABELS[key][lang];
  return typeof text === "function" ? text(params) : text;
}
