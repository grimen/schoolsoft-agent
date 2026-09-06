/** Guardian context: who is logged in, which children, which one the cookies are bound to. */
import type { GuardianChild } from "./types.js";

/** What we persist between runs so tools know whose data they serve. */
export interface GuardianContext {
  userId: number;
  parentName: string;
  children: GuardianChild[];
  /** studentId the session cookies are currently bound to. */
  childInFocus: number;
}

export function childOf(ctx: GuardianContext, studentId = ctx.childInFocus): GuardianChild {
  const child = ctx.children.find((c) => c.studentId === studentId);
  if (!child) {
    throw new Error(
      `Unknown child id ${studentId}. Known children: ` +
        ctx.children.map((c) => `${c.studentId} (${c.firstName})`).join(", "),
    );
  }
  return child;
}

export function orgIdOf(child: GuardianChild): number {
  const org = child.schools[0]?.orgId;
  if (org === undefined) throw new Error(`Child ${child.studentId} has no school`);
  return org;
}
