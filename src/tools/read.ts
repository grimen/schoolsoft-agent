/**
 * Read-only tools for a guardian account. Every tool serves data for the
 * child currently "in focus" (see schoolsoft_list_children); pass
 * child_id to switch. Endpoints verified live against Täby 2026-09-06 —
 * see src/api/guardian.ts.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sessionManager, guardianApi } from "../services/wiring.js";
import type { SessionManager } from "../services/session-manager.js";
import { ok, guarded } from "../services/respond.js";
import { childOf, orgIdOf, type GuardianApi } from "../api/guardian.js";

export function isoWeek(date = new Date()): number {
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

const ChildSchema = z
  .number()
  .int()
  .optional()
  .describe(
    "Child's student id from schoolsoft_list_children. Defaults to the child currently in focus.",
  );

const READ_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export function registerReadTools(
  server: McpServer,
  getManager: () => SessionManager = sessionManager,
  getApi: (m: SessionManager) => GuardianApi = guardianApi,
): void {
  /** Ensure a session, optionally switch child, return everything tools need. */
  async function ctx(childId?: number) {
    const manager = getManager();
    await manager.ensureSession();
    const guardian =
      childId !== undefined ? await manager.focusChild(childId) : manager.guardian();
    const child = childOf(guardian);
    return {
      api: getApi(manager),
      guardian,
      child,
      orgId: orgIdOf(child),
      childSummary: { studentId: child.studentId, firstName: child.firstName },
    };
  }

  server.registerTool(
    "schoolsoft_list_children",
    {
      title: "List children",
      description: `List the children on this guardian account and which one is in focus.

Returns: { children: [{ studentId, firstName, school, className }], childInFocus }.

Use when: the user has more than one child, or before passing child_id
to another tool.`,
      inputSchema: {},
      annotations: READ_ANNOTATIONS,
    },
    guarded(async () => {
      const { guardian } = await ctx();
      return ok({
        parent: guardian.parentName,
        children: guardian.children.map((c) => ({
          studentId: c.studentId,
          firstName: c.firstName,
          school: c.schools[0]?.name ?? null,
          className: c.schools[0]?.className ?? null,
        })),
        childInFocus: guardian.childInFocus,
      });
    }),
  );

  server.registerTool(
    "schoolsoft_get_schedule",
    {
      title: "Get schedule",
      description: `Get the lesson schedule (timetable) for one child for a given ISO week.

Returns lessons with name, start/end (ISO datetime), room, teaching group
and teacher.

Args:
  - week (number, optional): ISO week 1–53. Defaults to current week.
  - child_id (number, optional): from schoolsoft_list_children.

Returns: { week, child, lessons: [...] }

Use when: "vad har barnet på schemat", "när slutar skolan på fredag".`,
      inputSchema: { week: WeekSchema, child_id: ChildSchema },
      annotations: READ_ANNOTATIONS,
    },
    guarded(async ({ week, child_id }: { week?: number; child_id?: number }) => {
      const { api, childSummary } = await ctx(child_id);
      const w = week ?? isoWeek();
      const lessons = await api.getScheduleWeek(w);
      return ok({ week: w, child: childSummary, lessons });
    }),
  );

  server.registerTool(
    "schoolsoft_get_lunch_menu",
    {
      title: "Get lunch menu",
      description: `Get the school lunch menu for a given ISO week (child's school).

Args:
  - week (number, optional): ISO week 1–53. Defaults to current week.
  - child_id (number, optional): from schoolsoft_list_children.

Returns: { week, child, menu: [{ week, dayId (Mon=1…Fri=5), dishes: [{ mealType, description }] }] }.

Use when: "vad är det till lunch", "vad serveras på onsdag".`,
      inputSchema: { week: WeekSchema, child_id: ChildSchema },
      annotations: READ_ANNOTATIONS,
    },
    guarded(async ({ week, child_id }: { week?: number; child_id?: number }) => {
      const { api, orgId, childSummary } = await ctx(child_id);
      const w = week ?? isoWeek();
      const menu = await api.getLunchWeek(orgId, w);
      return ok({ week: w, child: childSummary, menu });
    }),
  );

  server.registerTool(
    "schoolsoft_get_assignments",
    {
      title: "Get assignments",
      description: `Get assignments (homework, tests, projects) for one child for a given ISO week.

Args:
  - week (number, optional): ISO week 1–53. Defaults to current week.
  - year (number, optional): Defaults to current year.
  - child_id (number, optional): from schoolsoft_list_children.

Returns: { week, year, child, assignments: [{ id, title, subTitle, sortDate, submissionStatus, ... }] }.

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
        child_id: ChildSchema,
      },
      annotations: READ_ANNOTATIONS,
    },
    guarded(
      async ({ week, year, child_id }: { week?: number; year?: number; child_id?: number }) => {
        const { api, childSummary } = await ctx(child_id);
        const w = week ?? isoWeek();
        const y = year ?? new Date().getFullYear();
        const assignments = await api.getAssignmentsWeek(w, y);
        return ok({ week: w, year: y, child: childSummary, assignments });
      },
    ),
  );

  server.registerTool(
    "schoolsoft_get_assignment_detail",
    {
      title: "Get assignment details",
      description: `Get full details for one assignment, including its sections.

Args:
  - id (number): Assignment id from schoolsoft_get_assignments.

Returns: { assignment: { view, sections } }.`,
      inputSchema: {
        id: z.number().int().describe("Assignment id from schoolsoft_get_assignments"),
      },
      annotations: READ_ANNOTATIONS,
    },
    guarded(async ({ id }: { id: number }) => {
      const { api } = await ctx();
      const assignment = await api.getAssignmentDetail(id);
      return ok({ assignment });
    }),
  );

  server.registerTool(
    "schoolsoft_get_news",
    {
      title: "Get news",
      description: `Get news/announcements from the child's school.

Args:
  - child_id (number, optional): from schoolsoft_list_children.
  - limit (number, optional): max items, default 20.

Returns: { child, news: [{ id, title, description, category, creDate, toDate, read, hasAttachment, author }] }.

Use when: "något nytt från skolan", "senaste nyheterna".`,
      inputSchema: {
        child_id: ChildSchema,
        limit: z.number().int().min(1).max(100).optional().describe("Max items, default 20"),
      },
      annotations: READ_ANNOTATIONS,
    },
    guarded(async ({ child_id, limit }: { child_id?: number; limit?: number }) => {
      const { api, guardian, orgId, child, childSummary } = await ctx(child_id);
      const news = await api.getNews(guardian.userId, orgId, child.studentId);
      return ok({ child: childSummary, news: news.slice(0, limit ?? 20) });
    }),
  );

  server.registerTool(
    "schoolsoft_get_messages",
    {
      title: "Get message inbox",
      description: `List messages in the guardian's SchoolSoft inbox (newest first).

Args:
  - child_id (number, optional): selects the school whose inbox to read.
  - limit (number, optional): max items, default 20.
  - unread_only (boolean, optional): only unread messages.

Returns: { messages: [{ id, subject, message (preview), isRead, sender, date, hasFiles }] }.
For a full message body use schoolsoft_get_message.

Use when: "har jag fått något meddelande från skolan", "olästa meddelanden".`,
      inputSchema: {
        child_id: ChildSchema,
        limit: z.number().int().min(1).max(100).optional().describe("Max items, default 20"),
        unread_only: z.boolean().optional().describe("Only unread messages"),
      },
      annotations: READ_ANNOTATIONS,
    },
    guarded(
      async ({
        child_id,
        limit,
        unread_only,
      }: {
        child_id?: number;
        limit?: number;
        unread_only?: boolean;
      }) => {
        const { api, guardian, orgId } = await ctx(child_id);
        let messages = (await api.getInbox(guardian.userId, orgId)) as { isRead?: boolean }[];
        if (unread_only) messages = messages.filter((m) => m.isRead === false);
        return ok({ messages: messages.slice(0, limit ?? 20) });
      },
    ),
  );

  server.registerTool(
    "schoolsoft_get_message",
    {
      title: "Get one message",
      description: `Get the full body of one inbox message.

Args:
  - id (number): Message id from schoolsoft_get_messages.
  - child_id (number, optional): selects the school.

Returns: { message: { id, subject, message, sender, date, recipients, attachments, ... } }.`,
      inputSchema: {
        id: z.number().int().describe("Message id from schoolsoft_get_messages"),
        child_id: ChildSchema,
      },
      annotations: READ_ANNOTATIONS,
    },
    guarded(async ({ id, child_id }: { id: number; child_id?: number }) => {
      const { api, guardian, orgId } = await ctx(child_id);
      const message = await api.getMessage(guardian.userId, orgId, id);
      return ok({ message });
    }),
  );
}
