import { z } from "zod";
import { defineOperation, READ_ONLY } from "./types.js";
import { ChildSchema, withChild } from "./_shared.js";
import { BookingSchema, ChildRefSchema } from "../domain/schemas.js";

export const getBookings = defineOperation({
  name: "get_bookings",
  title: "Get bookings",
  description: `List bookable and booked meetings (Bokningar), e.g. development talks
("utvecklingssamtal"), as the page shows them. Read only: booking a slot is
not supported yet.

Served through the headless browser (no API); run "schoolsoft-agent browser install" once.

Args:
  - child_id (number, optional): from list_children.

Returns: { child: { id, firstName }, bookings: [{ id, title, description, start, end, status: "available" | "booked" | "closed" | "unknown", details: [{ label, value }] }] }.

Use when: "när är utvecklingssamtalet", "finns det tider att boka".`,
  input: { child_id: ChildSchema },
  output: z.object({ child: ChildRefSchema, bookings: z.array(BookingSchema) }),
  portal: ["getBookings"],
  annotations: READ_ONLY,
  async run(ctx, { child_id }) {
    const { childRef } = await withChild(ctx, child_id);
    const bookings = await ctx.portal.getBookings();
    return { child: childRef, bookings };
  },
});
