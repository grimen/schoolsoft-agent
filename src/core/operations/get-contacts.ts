import { defineOperation, READ_ONLY } from "./types.js";
import { ChildSchema, withChild } from "./_shared.js";

export const getContacts = defineOperation({
  name: "get_contacts",
  title: "Get class contact list",
  description: `Get the contact list for the child's class (Kontaktlistor): classmates and,
where the school publishes them, guardians, with e-mail and phone.

Served through the headless browser (SchoolSoft has no API for this page);
run "schoolsoft-agent browser install" once. Personal data of other
families: show only what the user asked for.

Args:
  - child_id (number, optional): from list_children.

Returns: { child, groups: [{ title, people: [{ name, role, email?, phone? }] }] }.

Use when: "vad heter Ellas klasskompisar", "mejl till föräldrarna i klassen".`,
  input: { child_id: ChildSchema },
  portal: ["getContacts"],
  annotations: READ_ONLY,
  async run(ctx, { child_id }) {
    const { childSummary } = await withChild(ctx, child_id);
    const groups = await ctx.portal.getContacts();
    return { child: childSummary, groups };
  },
});
