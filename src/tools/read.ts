import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sessionManager } from "../services/wiring.js";
import type { SessionManager } from "../services/session-manager.js";
import { ok, guarded } from "../services/respond.js";

function isoWeek(date = new Date()): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

const WeekSchema = z
  .number()
  .int()
  .min(1)
  .max(53)
  .optional()
  .describe("ISO week number 1–53. Defaults to the current week.");

export function registerReadTools(
  server: McpServer,
  getManager: () => SessionManager = sessionManager,
): void {
  server.registerTool(
    "schoolsoft_get_schedule",
    {
      title: "Get schedule",
      description: `Get the lesson schedule (timetable) for a given ISO week.

Returns lessons sorted chronologically with subject, time, room and group.

Args:
  - week (number, optional): ISO week 1–53. Defaults to current week.

Returns: { week, lessons: [{ subject, day, startTime, endTime, room, ... }] }

Use when: "vad har jag/barnet på schemat", "när slutar skolan på fredag".`,
      inputSchema: { week: WeekSchema },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    guarded(async ({ week }: { week?: number }) => {
      const client = await getManager().ensureSession();
      const result = await client.getSchedule(week);
      return ok({ week: result.week, lessons: result.lessons });
    }),
  );

  server.registerTool(
    "schoolsoft_get_lunch_menu",
    {
      title: "Get lunch menu",
      description: `Get the school lunch menu for a given ISO week.

Args:
  - week (number, optional): ISO week 1–53. Defaults to current week.

Returns: { week, menu: [...] } with one entry per day.

Use when: "vad är det till lunch", "vad serveras på onsdag".`,
      inputSchema: { week: WeekSchema },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    guarded(async ({ week }: { week?: number }) => {
      const client = await getManager().ensureSession();
      const w = week ?? isoWeek();
      const menu = await client.getLunch(w);
      return ok({ week: w, menu });
    }),
  );

  server.registerTool(
    "schoolsoft_get_assignments",
    {
      title: "Get assignments",
      description: `Get assignments (homework, tests, projects) for a given ISO week.

Args:
  - week (number, optional): ISO week 1–53. Defaults to current week.
  - year (number, optional): Defaults to current year.

Returns: { week, year, assignments: [...] }.

Use when: "vilka läxor/prov finns den här veckan", "vad ska lämnas in".
For full details of one assignment, use schoolsoft_get_assignment_detail.`,
      inputSchema: {
        week: WeekSchema,
        year: z
          .number()
          .int()
          .min(2000)
          .max(2100)
          .optional()
          .describe("Calendar year. Defaults to the current year."),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    guarded(async ({ week, year }: { week?: number; year?: number }) => {
      const client = await getManager().ensureSession();
      const w = week ?? isoWeek();
      const y = year ?? new Date().getFullYear();
      const assignments = await client.getAssignmentsForWeek(w, y);
      return ok({ week: w, year: y, assignments });
    }),
  );

  server.registerTool(
    "schoolsoft_get_assignment_detail",
    {
      title: "Get assignment details",
      description: `Get full details for one assignment or planning entry, including
sections, assessment criteria and grading.

Args:
  - id (number): Assignment id from schoolsoft_get_assignments.
  - type ('assignment' | 'planning', optional): Defaults to 'assignment'.

Returns: full assignment detail object.`,
      inputSchema: {
        id: z.number().int().describe("Assignment id from schoolsoft_get_assignments"),
        type: z
          .enum(["assignment", "planning"])
          .optional()
          .describe("Entry type, defaults to 'assignment'"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    guarded(
      async ({ id, type }: { id: number; type?: "assignment" | "planning" }) => {
        const client = await getManager().ensureSession();
        const detail = await client.getAssignment(id, type);
        return ok({ assignment: detail });
      },
    ),
  );

  server.registerTool(
    "schoolsoft_get_news",
    {
      title: "Get news",
      description: `Get news/announcements from the school's startpage feed.

Returns: { news: [{ id, title, preview }] }.

Use when: "något nytt från skolan", "senaste nyheterna".`,
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    guarded(async () => {
      const client = await getManager().ensureSession();
      const news = await client.getNews();
      return ok({ news });
    }),
  );

  server.registerTool(
    "schoolsoft_get_subjects",
    {
      title: "Get subjects",
      description: `List all subject rooms with teachers and unread counts.

Returns: { subjects: [...] }.

Use when: overview of courses/subjects, or to find a subject id for
deeper queries.`,
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    guarded(async () => {
      const client = await getManager().ensureSession();
      const subjects = await client.getSubjects();
      return ok({ subjects });
    }),
  );
}
