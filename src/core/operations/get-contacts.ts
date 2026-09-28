import { defineOperation, READ_ONLY } from "./types.js";
import { ChildSchema, withChild, FreshSchema } from "./_shared.js";

export const getContacts = defineOperation({
  name: "get_contacts",
  title: "Get class contact list",
  description: `Get the contact list for the child's class (Kontaktlistor): classmates and,
where the school publishes them, guardians, by name and role. School staff
keep their work e-mail and phone. Other families' e-mail and phone are left
out (the group says detailsHidden: true) unless the user turned on
SCHOOLSOFT_CONTACT_DETAILS, which sends them to the AI provider; only the
user can change that setting.

Served through the headless browser (SchoolSoft has no API for this page);
run "schoolsoft-agent browser install" once. Personal data of other
families: show only what the user asked for.

Args:
  - child_id (number, optional): from list_children.
  - fresh (boolean, optional): accepted; this list is always read from SchoolSoft, never kept in memory.

Returns: { child, groups: [{ title, detailsHidden?, people: [{ name, role, email?, phone? }] }] }.

Use when: "vad heter Ellas klasskompisar", "mejla mentorn", "vilka går i klassen".`,
  input: { child_id: ChildSchema, fresh: FreshSchema },
  portal: ["getContacts"],
  annotations: READ_ONLY,
  async run(ctx, { child_id }) {
    const { childSummary } = await withChild(ctx, child_id);
    const groups = await ctx.portal.getContacts();
    return { child: childSummary, groups };
  },
});
