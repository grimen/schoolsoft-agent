import { z } from "zod";
import { defineOperation, READ_ONLY } from "./types.js";
import { ChildSchema, withChild, FreshSchema } from "./_shared.js";
import { ChildRefSchema, SubjectRoomSchema } from "../domain/schemas.js";

export const getSubjectRooms = defineOperation({
  name: "get_subject_rooms",
  title: "Get subject rooms",
  description: `List the child's subject rooms (Ämne) with groups and teachers.

Args:
  - child_id (number, optional): from list_children.
  - fresh (boolean, optional): read from SchoolSoft now instead of a recent in-memory copy.

Returns: { child: { id, firstName }, rooms: [{ id, name, groups, teachers: [{ name, role }] }] }.

Use when: "vem är Ellas mattelärare", "vilka ämnen har hon".`,
  input: { child_id: ChildSchema, fresh: FreshSchema },
  output: z.object({ child: ChildRefSchema, rooms: z.array(SubjectRoomSchema) }),
  portal: ["getSubjectRooms"],
  annotations: READ_ONLY,
  async run(ctx, { child_id }) {
    const { childRef } = await withChild(ctx, child_id);
    const rooms = await ctx.portal.getSubjectRooms();
    return { child: childRef, rooms };
  },
});
