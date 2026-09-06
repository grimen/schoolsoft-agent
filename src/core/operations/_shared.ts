import { z } from "zod";
import type { OperationContext } from "./types.js";
import { childOf, orgIdOf, type GuardianChild, type GuardianContext } from "../api/guardian.js";

export function isoWeek(date = new Date()): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
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

export interface ChildScope {
  guardian: GuardianContext;
  child: GuardianChild;
  orgId: number;
  childSummary: { studentId: number; firstName: string };
}

/** Ensure a session, optionally switch child, and describe the child in focus. */
export async function withChild(ctx: OperationContext, childId?: number): Promise<ChildScope> {
  await ctx.manager.ensureSession();
  const guardian =
    childId !== undefined ? await ctx.manager.focusChild(childId) : ctx.manager.guardian();
  const child = childOf(guardian);
  return {
    guardian,
    child,
    orgId: orgIdOf(child),
    childSummary: { studentId: child.studentId, firstName: child.firstName },
  };
}
