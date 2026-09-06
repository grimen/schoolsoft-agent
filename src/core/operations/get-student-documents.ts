import { defineOperation, READ_ONLY } from "./types.js";
import { ChildSchema, withChild } from "./_shared.js";

export const getStudentDocuments = defineOperation({
  name: "get_student_documents",
  title: "Get student documents",
  description: `Elevdokument: the child's student documents (title, created by, date) with links to open them in SchoolSoft.

GDPR-gated at SchoolSoft: needs a WEB login session (run "schoolsoft-agent login --web",
or the login tool with web: true, once) and the headless browser
("schoolsoft-agent browser install"). Read only.

Args:
  - child_id (number, optional): from list_children.

Returns: { child, page: { title, message?, sections: [{ heading?, headers, rows: [{ cells, url? }] }] } }.

Use when: the user asks about the child's documents.`,
  input: { child_id: ChildSchema },
  portal: ["getStudentDocuments"],
  annotations: READ_ONLY,
  async run(ctx, { child_id }) {
    const { childSummary } = await withChild(ctx, child_id);
    const page = await ctx.portal.getStudentDocuments();
    return { child: childSummary, page };
  },
});
