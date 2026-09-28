import { z } from "zod";
import { defineOperation, READ_ONLY } from "./types.js";
import { ChildSchema, withChild } from "./_shared.js";
import { ChildRefSchema, StudentDocumentSchema } from "../domain/schemas.js";

export const getStudentDocuments = defineOperation({
  name: "get_student_documents",
  title: "Get student documents",
  description: `Elevdokument: the child's student documents (title, created by, date) with links to open them in SchoolSoft.

GDPR-gated at SchoolSoft: needs a WEB login session (run "schoolsoft-agent login --web",
or the login tool with web: true, once) and the headless browser
("schoolsoft-agent browser install"). Read only.

Args:
  - child_id (number, optional): from list_children.

Returns: { child: { id, firstName }, documents: [{ id, title, createdBy, date, archived, link }] }.

Use when: the user asks about the child's documents.`,
  input: { child_id: ChildSchema },
  output: z.object({ child: ChildRefSchema, documents: z.array(StudentDocumentSchema) }),
  portal: ["getStudentDocuments"],
  annotations: READ_ONLY,
  async run(ctx, { child_id }) {
    const { childRef } = await withChild(ctx, child_id);
    const documents = await ctx.portal.getStudentDocuments();
    return { child: childRef, documents };
  },
});
