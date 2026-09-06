import { defineOperation, READ_ONLY } from "./types.js";
import { ChildSchema, withChild } from "./_shared.js";

export const getUnreportedAbsence = defineOperation({
  name: "get_unreported_absence",
  title: "Get unreported absence",
  description: `Oanmäld frånvaro: lessons the school marked as absent without a report from home, or the page's "nothing to show" message.

GDPR-gated at SchoolSoft: needs a WEB login session (run "schoolsoft-agent login --web",
or the login tool with web: true, once) and the headless browser
("schoolsoft-agent browser install"). Read only.

Args:
  - child_id (number, optional): from list_children.

Returns: { child, page: { title, message?, sections: [{ heading?, headers, rows: [{ cells, url? }] }] } }.

Use when: the user asks about the child's absence.`,
  input: { child_id: ChildSchema },
  annotations: READ_ONLY,
  async run(ctx, { child_id }) {
    const { childSummary } = await withChild(ctx, child_id);
    const page = await ctx.portal.getUnreportedAbsence();
    return { child: childSummary, page };
  },
});
