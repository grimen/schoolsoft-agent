import { z } from "zod";
import { AgentError } from "../errors/index.js";
import { childOf, type GuardianContext } from "../portal/guardian.js";
import type { AbsenceNotice, GuardianChild } from "../portal/types.js";
import { normalize } from "../school-directory.js";
import { defineOperation } from "./types.js";
import { ChildSchema, withChild } from "./_shared.js";
import { absenceWindow, ABSENCE_MAX_DAYS, type AbsenceWindow } from "./_absence-window.js";
import { CALENDAR_TIMEZONE } from "./_calendar-range.js";

const known = (g: GuardianContext) =>
  g.children.map((c) => `${c.firstName} (${c.studentId})`).join(", ") || "none";

/** A report never falls back to the child in focus when there is a choice to make. */
function pickChild(g: GuardianContext, name?: string, id?: number): GuardianChild {
  if (name !== undefined) {
    const wanted = normalize(name);
    const matches = g.children.filter(
      (c) =>
        normalize(c.firstName) === wanted || normalize(`${c.firstName} ${c.lastName}`) === wanted,
    );
    if (matches.length !== 1 || (id !== undefined && matches[0].studentId !== id))
      throw new AgentError({
        kind: "input",
        key: "child_name_not_found",
        params: { name, known: known(g) },
        hint: "list_children",
      });
    return matches[0];
  }
  if (id !== undefined) return childOf(g, id);
  if (g.children.length !== 1)
    throw new AgentError({
      kind: "input",
      key: "absence_child_required",
      params: { known: known(g) },
      hint: "list_children",
    });
  return g.children[0];
}

function summarize(child: GuardianChild, w: AbsenceWindow, reason?: string): string {
  const when =
    w.days === 1
      ? w.full_day
        ? `${w.start_date}, the whole day`
        : `${w.start_date} from ${w.from_time} to ${w.to_time}`
      : `${w.start_date} to ${w.end_date} (${w.days} days), whole days`;
  return `Report ${child.firstName} ${child.lastName} absent ${when}${reason ? `. Reason: ${reason}` : ""}.`;
}

export const reportAbsence = defineOperation({
  name: "report_absence",
  title: "Report a child absent",
  description: `Report a child absent (sjukanmälan / frånvaroanmälan). This CHANGES data at SchoolSoft.

Two steps. Without confirm it sends nothing and returns a preview of exactly what
would be reported. Show that preview to the user; call again with the same
arguments and confirm: true only after they have said yes. It is not idempotent:
never repeat a confirmed call on your own, also not after an error.

Off by default: the user must set SCHOOLSOFT_ALLOW_WRITES=1 first.

Args:
  - child (optional): the child's first or full name. Or child_id from list_children.
    Required when the guardian has more than one child.
  - start_date, end_date (optional): inclusive YYYY-MM-DD in Europe/Stockholm, today or
    later, at most ${ABSENCE_MAX_DAYS} days. Default: today; end_date defaults to start_date.
  - from_time, to_time (optional): HH:MM, both or neither, for part of a single day.
  - reason (optional): a short comment for the school.
  - confirm (optional): true sends the report.

Returns: { status: "preview" | "reported", child, start_date, end_date, days, full_day,
from_time?, to_time?, reason?, timezone, summary } and, when reported, response.

Use when: "Report Ett sick today", "anmäl frånvaro för Ett imorgon",
"sjukanmäl Två idag mellan 10 och 12".`,
  input: {
    child: z.string().min(1).max(100).optional().describe("Child's first or full name."),
    child_id: ChildSchema.describe(
      "Child's student id from list_children, as an alternative to child.",
    ),
    start_date: z
      .string()
      .optional()
      .describe("First day absent, YYYY-MM-DD (Europe/Stockholm). Default today."),
    end_date: z
      .string()
      .optional()
      .describe(
        `Last day absent, YYYY-MM-DD. Default start_date. At most ${ABSENCE_MAX_DAYS} days.`,
      ),
    from_time: z.string().optional().describe("Part of a day: start HH:MM. Needs to_time."),
    to_time: z.string().optional().describe("Part of a day: end HH:MM. Needs from_time."),
    reason: z.string().max(500).optional().describe("Optional short comment for the school."),
    confirm: z
      .boolean()
      .optional()
      .describe("true sends the report. Omitted: preview only, nothing is sent."),
  },
  portal: ["reportAbsence"],
  annotations: { readOnly: false, destructive: true, idempotent: false, requiresAuth: true },
  async run(ctx, args) {
    if (!ctx.config.allowWrites)
      throw new AgentError({
        kind: "not_available",
        key: "writes_disabled",
        params: { what: "report_absence" },
        hint: "enable_writes",
      });
    const window = absenceWindow(args);
    const reason = args.reason?.trim() || undefined;
    await ctx.manager.ensureSession();
    const child = pickChild(ctx.manager.guardian(), args.child, args.child_id);
    const described = {
      child: { studentId: child.studentId, firstName: child.firstName },
      ...window,
      ...(reason ? { reason } : {}),
      timezone: CALENDAR_TIMEZONE,
      summary: summarize(child, window, reason),
    };
    if (args.confirm !== true) return { status: "preview" as const, ...described };

    await withChild(ctx, child.studentId);
    const notice: AbsenceNotice = {
      studentId: child.studentId,
      startDate: window.start_date,
      endDate: window.end_date,
      fullDay: window.full_day,
      ...(window.full_day ? {} : { fromTime: window.from_time, toTime: window.to_time }),
      ...(reason ? { reason } : {}),
    };
    const receipt = await ctx.portal.reportAbsence(notice);
    return { status: "reported" as const, ...described, response: receipt.response };
  },
});
