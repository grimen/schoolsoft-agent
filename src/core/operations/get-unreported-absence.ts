import { z } from "zod";
import { defineOperation, READ_ONLY } from "./types.js";
import { ChildSchema, withChild } from "./_shared.js";
import { ChildRefSchema, TablePageSchema } from "../domain/schemas.js";

export const getUnreportedAbsence = defineOperation({
  name: "get_unreported_absence",
  title: "Get unreported absence",
  description: `Oanmäld frånvaro: lessons the school marked as absent without a report from home, or the page's "nothing to show" message.

GDPR-gated at SchoolSoft: needs a WEB login session (run "schoolsoft-agent login --web",
or the login tool with web: true, once) and the headless browser
("schoolsoft-agent browser install"). Read only.

Args:
  - child_id (number, optional): from list_children.

Returns: { child: { id, firstName }, page: { title, message, sections: [{ heading, headers, rows: [{ cells, link }] }] } }.

Use when: the user asks about the child's absence.`,
  input: { child_id: ChildSchema },
  portal: ["getUnreportedAbsence"],
  output: z.object({ child: ChildRefSchema, page: TablePageSchema }),
  annotations: READ_ONLY,
  async run(ctx, { child_id }) {
    const { childRef } = await withChild(ctx, child_id);
    const page = await ctx.portal.getUnreportedAbsence();
    return { child: childRef, page };
  },
});
