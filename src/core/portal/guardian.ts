/** Guardian context: who is logged in, which children, which one the cookies are bound to. */
import type { GuardianChild } from "./types.js";
import { AgentError } from "../errors/index.js";

export class ChildNotFoundError extends AgentError {
  constructor(id: number, known: string) {
    super({ kind: "input", key: "child_not_found", params: { id, known }, hint: "list_children" });
  }
}

export class ChildHasNoSchoolError extends AgentError {
  constructor(id: number) {
    super({ kind: "upstream", key: "child_no_school", params: { id }, hint: "list_children" });
  }
}

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
    throw new ChildNotFoundError(
      studentId,
      ctx.children.map((c) => `${c.studentId} (${c.firstName})`).join(", ") || "none",
    );
  }
  return child;
}

export function orgIdOf(child: GuardianChild): number {
  const org = child.schools[0]?.orgId;
  if (org === undefined) throw new ChildHasNoSchoolError(child.studentId);
  return org;
}
