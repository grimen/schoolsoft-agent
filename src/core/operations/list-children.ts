import { z } from "zod";
import { defineOperation, READ_ONLY } from "./types.js";
import { withChild } from "./_shared.js";
import { ChildSchema } from "../domain/schemas.js";
import type { GuardianChild } from "../portal/types.js";

/** A guardian's child as the domain model shows it. */
export function toChild(c: GuardianChild) {
  return {
    id: c.studentId,
    firstName: c.firstName,
    schoolName: c.schools[0]?.name || null,
    className: c.schools[0]?.className || null,
  };
}

export const listChildren = defineOperation({
  name: "list_children",
  title: "List children",
  description: `List the children on this guardian account and which one is in focus.

Returns: { guardianName, children: [{ id, firstName, schoolName, className }], childInFocus }.

Use when: the user has more than one child, or before passing child_id
to another operation.`,
  input: {},
  output: z.object({
    guardianName: z.string(),
    children: z.array(ChildSchema),
    childInFocus: z.number().int().describe("Id of the child reads default to"),
  }),
  portal: [],
  annotations: READ_ONLY,
  async run(ctx) {
    const { guardian } = await withChild(ctx);
    return {
      guardianName: guardian.parentName,
      children: guardian.children.map(toChild),
      childInFocus: guardian.childInFocus,
    };
  },
});
