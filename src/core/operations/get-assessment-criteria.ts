import { z } from "zod";
import { defineOperation, READ_ONLY } from "./types.js";
import { ChildSchema, withChild } from "./_shared.js";

export const getAssessmentCriteria = defineOperation({
  name: "get_assessment_criteria",
  title: "Get assessment criteria",
  description: `Kriterier för bedömning av kunskaper: the assessment matrix for one subject
(abilities by step, with what has been published so far).

GDPR-gated at SchoolSoft: needs a WEB login session (run "schoolsoft-agent login --web",
or the login tool with web: true, once) and the headless browser. Read only.

Args:
  - subject (string): subject name as listed by get_subject_rooms ("Matematik"; "matte" also matches).
  - school_type (number, optional): SchoolSoft school type code, default 7 (grundskola).
  - child_id (number, optional): from list_children.

Returns: { child, page: { title, message?, sections: [{ heading?, headers, rows }] } }.

Use when: "hur ligger Ella till i matte", "vilka kunskapskrav gäller i engelska".`,
  input: {
    subject: z.string().min(1).describe("Subject name, e.g. Matematik"),
    school_type: z.number().int().optional().describe("SchoolSoft school type code, default 7"),
    child_id: ChildSchema,
  },
  portal: ["getAssessmentCriteria"],
  annotations: READ_ONLY,
  async run(ctx, { subject, school_type, child_id }) {
    const { childSummary } = await withChild(ctx, child_id);
    const page = await ctx.portal.getAssessmentCriteria(subject, school_type);
    return { child: childSummary, page };
  },
});
