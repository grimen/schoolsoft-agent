import { z } from "zod";
import type { OperationContext } from "./types.js";
import type { GuardianChild } from "../portal/types.js";
import { childOf, orgIdOf, type GuardianContext } from "../portal/guardian.js";
import type { ChildRef } from "../domain/schemas.js";
import { isoWeekOfDate } from "./_week.js";
import { stockholmToday } from "./_calendar-range.js";

/** The current ISO week number in Europe/Stockholm (or at `date`). */
export function isoWeek(date = new Date()): number {
  return isoWeekOfDate(stockholmToday(date));
}

export const WeekSchema = z
  .number()
  .int()
  .min(1)
  .max(53)
  .optional()
  .describe("ISO week number 1–53. Defaults to the current week.");

export const YearSchema = z
  .number()
  .int()
  .min(2000)
  .max(2100)
  .optional()
  .describe("Calendar year. Defaults to the current year.");

export const ChildSchema = z
  .number()
  .int()
  .optional()
  .describe("Child's student id from list_children. Defaults to the child currently in focus.");

export const LimitSchema = z
  .number()
  .int()
  .min(1)
  .max(100)
  .optional()
  .describe("Max items, default 20");

export const FreshSchema = z
  .boolean()
  .optional()
  .describe(
    "Skip the short-lived in-memory copy and read from SchoolSoft now. Use only when the user asks for the very latest.",
  );

export interface ChildScope {
  guardian: GuardianContext;
  child: GuardianChild;
  orgId: number;
  /** The child as untyped outputs name it (kept until E4.5 types them). */
  childSummary: { studentId: number; firstName: string };
  /** The child as typed outputs name it. */
  childRef: ChildRef;
}

/** Ensure a session, optionally switch child, and describe the child in focus. */
export async function withChild(
  ctx: Pick<OperationContext<never>, "manager">,
  childId?: number,
): Promise<ChildScope> {
  await ctx.manager.ensureSession();
  const guardian =
    childId !== undefined ? await ctx.manager.focusChild(childId) : ctx.manager.guardian();
  const child = childOf(guardian);
  return {
    guardian,
    child,
    orgId: orgIdOf(child),
    childSummary: { studentId: child.studentId, firstName: child.firstName },
    childRef: { id: child.studentId, firstName: child.firstName },
  };
}
