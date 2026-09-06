import { defineOperation, READ_ONLY } from "./types.js";
import { withChild } from "./_shared.js";

export const listChildren = defineOperation({
  name: "list_children",
  title: "List children",
  description: `List the children on this guardian account and which one is in focus.

Returns: { parent, children: [{ studentId, firstName, school, className }], childInFocus }.

Use when: the user has more than one child, or before passing child_id
to another operation.`,
  input: {},
  annotations: READ_ONLY,
  async run(ctx) {
    const { guardian } = await withChild(ctx);
    return {
      parent: guardian.parentName,
      children: guardian.children.map((c) => ({
        studentId: c.studentId,
        firstName: c.firstName,
        school: c.schools[0]?.name ?? null,
        className: c.schools[0]?.className ?? null,
      })),
      childInFocus: guardian.childInFocus,
    };
  },
});
