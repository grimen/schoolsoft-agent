import { defineOperation, READ_ONLY } from "./types.js";
import { ChildSchema, withChild } from "./_shared.js";

export const getSubjectRooms = defineOperation({
  name: "get_subject_rooms",
  title: "Get subject rooms",
  description: `List the child's subjects (Ämne) with their teachers.

Served through the headless browser (no API); run "schoolsoft-agent browser install" once.

Args:
  - child_id (number, optional): from list_children.

Returns: { child, subjects: [{ subject, teachers, url }] }.

Use when: "vem är Ellas mattelärare", "vilka ämnen har hon".`,
  input: { child_id: ChildSchema },
  annotations: READ_ONLY,
  async run(ctx, { child_id }) {
    const { childSummary } = await withChild(ctx, child_id);
    const subjects = await ctx.portal.getSubjectRooms();
    return { child: childSummary, subjects };
  },
});
