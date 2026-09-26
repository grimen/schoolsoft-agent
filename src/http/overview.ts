/**
 * The composite overview (E5.6): one request per child for a dashboard's first paint.
 * Its sections are the connector's typed operations, run in one turn of the runtime's
 * queue (`executeForChild`). Each section carries its operation's validated output,
 * says the connection was not granted it, or carries the problem that stopped it, so
 * one failing read never blanks the others. No scope of its own: a section needs its
 * operation's scope, exactly as the single route does.
 */
import { z } from "zod";
import {
  CalendarEventSchema,
  ChildSchema,
  DOMAIN_TIMEZONE,
  FreshSchema,
  LocalDateSchema,
  getOperation,
  stockholmToday,
  toChild,
  weekOf,
  weekOfDate,
  type CalendarEvent,
  type GuardianChild,
  type WeekRange,
} from "../core/index.js";
import { ConnectorRefusedError, type ChildRead, type ReadOutcome } from "./runtime.js";
import {
  ProblemSchema,
  classify,
  type Classified,
  type ProblemBody,
  type ProblemName,
} from "./problem.js";
import { queryShape } from "./routes.js";

/** The route below `/children/{childId}/`. */
export const OVERVIEW_SLUG = "overview";

/** The query string: a day of the week to show and `fresh`. */
export const OVERVIEW_QUERY = queryShape({
  date: z
    .string()
    .optional()
    .describe(
      "Any day of the week to show, YYYY-MM-DD, within about half a year of today. Defaults to today in Europe/Stockholm.",
    ),
  fresh: FreshSchema,
});

/** How many days `nextEvent` searches, today included. */
export const NEXT_EVENT_DAYS = 30;
const DAY = 86_400_000;

/**
 * Failures that concern one section's read; the section carries them and the others are
 * still served. Anything else (the token, the child, the connector's SchoolSoft session,
 * a busy or closing connector, a cancelled request) fails the whole overview.
 */
export const SECTION_PROBLEMS: ReadonlySet<ProblemName> = new Set<ProblemName>([
  "response-drift",
  "upstream",
  "network",
  "portal-pushback",
  "not-implemented",
  "not-available",
  "web-session",
  "internal",
]);
export const keptInSection = (error: unknown): boolean =>
  SECTION_PROBLEMS.has(classify(error).name);

const outputOf = (name: string) => getOperation(name)!.output as z.ZodType;

export const NextEventSchema = z.object({
  event: CalendarEventSchema.nullable().describe(
    'The first school event (kind "event") that has not ended, by start; null when there is none',
  ),
  from: LocalDateSchema.describe("First day searched: today in Europe/Stockholm"),
  until: LocalDateSchema.describe(`Last day searched: ${NEXT_EVENT_DAYS - 1} days after today`),
});
export type NextEvent = z.infer<typeof NextEventSchema>;

/** A section: its data, "not granted" with the scope it needs, or the problem that stopped it. */
export function sectionSchema<T extends z.ZodType>(data: T) {
  return z.discriminatedUnion("status", [
    z.object({ status: z.literal("ok"), data }),
    z.object({
      status: z.literal("not-granted"),
      scope: z.string().describe("The scope this connection lacks; nothing was read"),
    }),
    z.object({ status: z.literal("error"), problem: ProblemSchema }),
  ]);
}

export const OverviewWeekSchema = z.object({
  year: z.number().int().describe("ISO week-year"),
  week: z.number().int().min(1).max(53).describe("ISO week number"),
  startDate: LocalDateSchema.describe("Monday of the week"),
  endDate: LocalDateSchema.describe("Sunday of the week"),
  today: LocalDateSchema.describe("Today in Europe/Stockholm, the start of nextEvent's search"),
  timezone: z.literal(DOMAIN_TIMEZONE),
});

interface SectionSpec {
  /** The operation that serves it; its name is also the scope it needs. */
  operation: string;
  /** The schema of the section's `data`. */
  schema: z.ZodType;
  args(week: WeekRange, today: string): Record<string, unknown>;
  /** The section's `data` from the operation's validated output. */
  toData(output: unknown, today: string, now: number): unknown;
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(date + "T00:00:00Z") + days * DAY).toISOString().slice(0, 10);
}

/** Dates sort before date-times of the same day; date-times carry Stockholm's offset. */
const startKey = (event: CalendarEvent) =>
  event.start.length === 10 ? event.start + "T00:00:00" : event.start.slice(0, 19);

/** The first school event that has not ended at `now`, by start; ties keep calendar order. */
export function nextEvent(
  events: readonly CalendarEvent[],
  today: string,
  now: number,
): CalendarEvent | null {
  const upcoming = events.filter(
    (event) =>
      event.kind === "event" &&
      (event.end.length === 10 ? event.end >= today : Date.parse(event.end) > now),
  );
  return upcoming.sort((a, b) => startKey(a).localeCompare(startKey(b)))[0] ?? null;
}

/** The sections, in the order they are read and answered. */
export const SECTIONS = {
  schedule: {
    operation: "get_schedule",
    schema: outputOf("get_schedule"),
    args: (week) => ({ week: week.week }),
    toData: (output) => output,
  },
  lunch: {
    operation: "get_lunch_menu",
    schema: outputOf("get_lunch_menu"),
    args: (week) => ({ week: week.week }),
    toData: (output) => output,
  },
  nextEvent: {
    operation: "get_calendar",
    schema: NextEventSchema,
    args: (_week, today) => ({ start_date: today, end_date: addDays(today, NEXT_EVENT_DAYS - 1) }),
    toData: (output, today, now) => ({
      event: nextEvent((output as { events: CalendarEvent[] }).events, today, now),
      from: today,
      until: addDays(today, NEXT_EVENT_DAYS - 1),
    }),
  },
} satisfies Record<string, SectionSpec>;
type SectionKey = keyof typeof SECTIONS;
const KEYS = Object.keys(SECTIONS) as SectionKey[];

/** The scopes of which an overview needs at least one. */
export const OVERVIEW_SCOPES: readonly string[] = KEYS.map((key) => SECTIONS[key].operation);

export const OverviewSchema = z.object({
  child: ChildSchema.describe("The child in the path"),
  week: OverviewWeekSchema,
  schedule: sectionSchema(SECTIONS.schedule.schema).describe(
    "The week's lessons: get_schedule's output",
  ),
  lunch: sectionSchema(SECTIONS.lunch.schema).describe("The week's lunch: get_lunch_menu's output"),
  nextEvent: sectionSchema(SECTIONS.nextEvent.schema).describe(
    `The next school event from today, within ${NEXT_EVENT_DAYS} days (get_calendar)`,
  ),
});
export type Overview = z.infer<typeof OverviewSchema>;

export interface OverviewRequest {
  childId: number;
  input: { date?: string; fresh?: boolean };
  /** The token's scopes; a section whose scope is missing is not read. */
  scopes: readonly string[];
  now: number;
  /** Run the reads for the child in one turn of the queue (`executeForChild`). */
  read(
    reads: ChildRead[],
    keep: (error: unknown) => boolean,
  ): Promise<{ child: GuardianChild; results: ReadOutcome[] }>;
  /** A kept failure as the problem body the single route would answer. */
  problem(classified: Classified): ProblemBody;
}

/** Build one child's overview; throws for input errors and whatever fails the whole request. */
export async function buildOverview(request: OverviewRequest): Promise<Overview> {
  const clock = new Date(request.now);
  const today = stockholmToday(clock);
  const week =
    request.input.date === undefined
      ? weekOf(undefined, clock)
      : weekOfDate(request.input.date, clock);
  const fresh = request.input.fresh === undefined ? {} : { fresh: request.input.fresh };
  const granted = KEYS.filter((key) => request.scopes.includes(SECTIONS[key].operation));
  const { child, results } = await request.read(
    granted.map((key) => ({
      name: SECTIONS[key].operation,
      args: { ...SECTIONS[key].args(week, today), ...fresh },
    })),
    keptInSection,
  );
  const sections: Record<string, unknown> = {};
  for (const key of KEYS) {
    const spec: SectionSpec = SECTIONS[key];
    const index = granted.indexOf(key);
    if (index < 0) {
      sections[key] = { status: "not-granted", scope: spec.operation };
      continue;
    }
    const outcome = results[index];
    if (!outcome.ok) {
      sections[key] = { status: "error", problem: request.problem(classify(outcome.error)) };
      continue;
    }
    // The runtime reads under the child's own focus; checked again so that a fault on
    // either side can never put one child's data under another child's name.
    if ((outcome.value as { child: { id: number } }).child.id !== request.childId)
      throw new ConnectorRefusedError("child_changed", "A section answered for another child.");
    sections[key] = { status: "ok", data: spec.toData(outcome.value, today, request.now) };
  }
  return OverviewSchema.parse({
    child: toChild(child),
    week: { ...week, today, timezone: DOMAIN_TIMEZONE },
    ...sections,
  });
}
