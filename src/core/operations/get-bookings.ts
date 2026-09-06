import { defineOperation, READ_ONLY } from "./types.js";
import { ChildSchema, withChild } from "./_shared.js";

export const getBookings = defineOperation({
  name: "get_bookings",
  title: "Get bookings",
  description: `List bookable and booked meetings (Bokningar), e.g. development talks
("utvecklingssamtal"), as the page shows them. Read only: booking a slot is
not supported yet.

Served through the headless browser (no API); run "schoolsoft-agent browser install" once.

Args:
  - child_id (number, optional): from list_children.

Returns: { child, bookings: [{ title, description?, slots: [{ start, status }], info? }] }.

Use when: "när är utvecklingssamtalet", "finns det tider att boka".`,
  input: { child_id: ChildSchema },
  annotations: READ_ONLY,
  async run(ctx, { child_id }) {
    const { childSummary } = await withChild(ctx, child_id);
    const bookings = await ctx.portal.getBookings();
    return { child: childSummary, bookings };
  },
});
