/** SchoolSoft agenda shape. Unknown optional fields are retained, not interpreted. */
import { z } from "zod";
import { AgentError } from "../../../../core/errors/index.js";

const timestamp = z.union([z.iso.date(), z.iso.datetime({ local: true })]);
const agendaSchema = z.array(
  z
    .object({
      eventId: z.union([z.string(), z.number()]),
      name: z.string(),
      startDate: timestamp,
      endDate: timestamp,
      allDay: z.boolean(),
    })
    .passthrough(),
);

export function calendarEntries(data: unknown, source: "lessons" | "events") {
  const result = agendaSchema.safeParse(data);
  if (!result.success)
    throw new AgentError({ kind: "upstream", key: "calendar_response", hint: "retry" });
  return result.data.map((entry) => ({ ...entry, source }));
}

export function sortCalendar(entries: ReturnType<typeof calendarEntries>) {
  return entries.sort(
    (a, b) =>
      a.startDate.localeCompare(b.startDate) ||
      a.endDate.localeCompare(b.endDate) ||
      a.source.localeCompare(b.source) ||
      String(a.eventId).localeCompare(String(b.eventId)) ||
      a.name.localeCompare(b.name),
  );
}
