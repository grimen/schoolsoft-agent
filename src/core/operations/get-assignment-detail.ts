import { z } from "zod";
import { defineOperation, READ_ONLY } from "./types.js";
import { withChild } from "./_shared.js";

export const getAssignmentDetail = defineOperation({
  name: "get_assignment_detail",
  title: "Get assignment details",
  description: `Get full details for one assignment, including its sections.

Args:
  - id (number): Assignment id from get_assignments.

Returns: { assignment: { view, sections } }.

Use when: the user asks what an assignment is about, its instructions or
assessment, after get_assignments listed it.`,
  input: { id: z.number().int().describe("Assignment id from get_assignments") },
  annotations: READ_ONLY,
  async run(ctx, { id }) {
    await withChild(ctx);
    const assignment = await ctx.portal.getAssignmentDetail(id);
    return { assignment };
  },
});
