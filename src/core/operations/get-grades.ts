import { defineOperation, READ_ONLY } from "./types.js";
import { ChildSchema, withChild } from "./_shared.js";

export const getGrades = defineOperation({
  name: "get_grades",
  title: "Get grades",
  description: `Betyg: the child's published grades (grade tables as the page shows them; empty until the school publishes grades, typically from year 6).

GDPR-gated at SchoolSoft: needs a WEB login session (run "schoolsoft-agent login --web",
or the login tool with web: true, once) and the headless browser
("schoolsoft-agent browser install"). Read only.

Args:
  - child_id (number, optional): from list_children.

Returns: { child, page: { title, message?, sections: [{ heading?, headers, rows: [{ cells, url? }] }] } }.

Use when: the user asks about the child's grades.`,
  input: { child_id: ChildSchema },
  annotations: READ_ONLY,
  async run(ctx, { child_id }) {
    const { childSummary } = await withChild(ctx, child_id);
    const page = await ctx.portal.getGrades();
    return { child: childSummary, page };
  },
});
