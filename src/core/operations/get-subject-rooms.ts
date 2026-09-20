import { defineOperation, READ_ONLY } from "./types.js";
import { ChildSchema, withChild, FreshSchema } from "./_shared.js";

export const getSubjectRooms = defineOperation({
  name: "get_subject_rooms",
  title: "Get subject rooms",
  description: `List the child's subject rooms (Ämne) with groups and teachers.

Args:
  - child_id (number, optional): from list_children.
  - fresh (boolean, optional): read from SchoolSoft now instead of a recent in-memory copy.

Returns: { child, subjects: [{ subject, subjectId, groups, teachers }] }.

Use when: "vem är Ellas mattelärare", "vilka ämnen har hon".`,
  input: { child_id: ChildSchema, fresh: FreshSchema },
  portal: ["getSubjectRooms"],
  annotations: READ_ONLY,
  async run(ctx, { child_id }) {
    const { childSummary } = await withChild(ctx, child_id);
    const subjects = await ctx.portal.getSubjectRooms();
    return { child: childSummary, subjects };
  },
});
