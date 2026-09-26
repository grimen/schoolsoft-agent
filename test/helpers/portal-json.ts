/**
 * Synthetic portal JSON built to the response shapes recorded live on
 * 2026-09-06 (docs/reference/schoolsoft-api.md): field names as observed,
 * every value invented. The base answers live in test/fixtures/json/; this
 * module loads them, stamps a marker into one text field per shape (so a test
 * can tell which child's session served an answer) and builds the drifted
 * variants the E4.3 tests use: a renamed, a missing and a wrong-typed field.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Json = Record<string, unknown>;

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(process.cwd(), "test/fixtures/json", name), "utf8"));
}

export const rawParent = (): Json => fixture("parent.json") as Json;
export const rawLessonsWeek = (): Json[] => fixture("lessons-week.json") as Json[];
export const rawAgendaLessons = (): Json[] => fixture("agenda-lessons.json") as Json[];
export const rawAgendaEvents = (): Json[] => fixture("agenda-events.json") as Json[];
export const rawLunch = (): Json[] => fixture("lunchmenu.json") as Json[];
export const rawInbox = (): Json[] => fixture("inbox.json") as Json[];

/** Every entry's text field set to `marker` (lesson/event note, first dish, message preview). */
export function marked(pathname: string, marker: string): unknown {
  if (/\/calendar\/lessons\/week\/\d+$/.test(pathname))
    return rawLessonsWeek().map((l) => ({ ...l, description: marker }));
  if (pathname.endsWith("/calendar/lessons/agenda"))
    return rawAgendaLessons().map((l) => ({ ...l, description: marker }));
  if (pathname.endsWith("/calendar/event/agenda"))
    return rawAgendaEvents().map((e) => ({ ...e, description: marker }));
  const lunch = /\/lunchmenu\/(\d+)$/.exec(pathname);
  if (lunch)
    return rawLunch().map((d) => ({
      ...d,
      week: Number(lunch[1]),
      dishes: [{ mealType: "Lunch", description: marker }],
    }));
  if (pathname.endsWith("/messages/inbox"))
    return rawInbox().map((m) => ({ ...m, message: marker }));
  return undefined;
}

export type DriftKind = "renamed" | "missing" | "wrong-typed";
export const DRIFT_KINDS: readonly DriftKind[] = ["renamed", "missing", "wrong-typed"];

/** A copy of `entry` with `field` renamed (to `<field>_v2`), removed, or given a value of the wrong type. */
export function drift(entry: Json, field: string, kind: DriftKind): Json {
  const copy: Json = structuredClone(entry);
  const value = copy[field];
  delete copy[field];
  if (kind === "renamed") copy[`${field}_v2`] = value;
  if (kind === "wrong-typed") copy[field] = typeof value === "string" ? 12345 : "not-the-type";
  return copy;
}

/** The field each drift test breaks, per shape: one every mapper needs. */
export const DRIFT_FIELDS = {
  parent: "studentId",
  lessons: "startDate",
  agenda: "allDay",
  lunch: "dayId",
  inbox: "isRead",
} as const;

/** Raw answers with the first entry drifted. */
export function driftedParent(kind: DriftKind): Json {
  const parent = rawParent();
  const children = parent.children as Json[];
  children[0] = drift(children[0], DRIFT_FIELDS.parent, kind);
  return parent;
}
export const driftedList = (list: Json[], field: string, kind: DriftKind): Json[] => [
  drift(list[0], field, kind),
  ...list.slice(1),
];
