import { defineOperation, READ_ONLY } from "./types.js";
import { ChildSchema, withChild } from "./_shared.js";

export const getAttendanceReport = defineOperation({
  name: "get_attendance_report",
  title: "Get attendance report",
  description: `Rapport / Närvarorapport: attendance summary for the school's default week range (reasons, subjects, lessons, hours).

GDPR-gated at SchoolSoft: needs a WEB login session (run "schoolsoft-agent login --web",
or the login tool with web: true, once) and the headless browser
("schoolsoft-agent browser install"). Read only.

Args:
  - child_id (number, optional): from list_children.

Returns: { child, page: { title, message?, sections: [{ heading?, headers, rows: [{ cells, url? }] }] } }.

Use when: the user asks about the child's attendance.`,
  input: { child_id: ChildSchema },
  portal: ["getAttendanceReport"],
  annotations: READ_ONLY,
  async run(ctx, { child_id }) {
    const { childSummary } = await withChild(ctx, child_id);
    const page = await ctx.portal.getAttendanceReport();
    return { child: childSummary, page };
  },
});
