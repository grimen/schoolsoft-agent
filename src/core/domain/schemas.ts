/**
 * The vendor-neutral domain model: what operations promise to return,
 * whichever school portal served the data. Each type is a Zod schema so the
 * runner can validate results and the surfaces can publish the shape (MCP
 * outputSchema, generated docs). Providers map their raw answers to these;
 * see docs/planning/specs/2026-09-26-typed-domain-model.md.
 */
import { z } from "zod";

export const LocalDateSchema = z.iso
  .date()
  .describe("Calendar date YYYY-MM-DD in Europe/Stockholm");

export const DateTimeSchema = z.iso
  .datetime({ offset: true })
  .describe(
    "ISO-8601 date-time with Europe/Stockholm's UTC offset, e.g. 2026-09-07T08:30:00+02:00",
  );

const text = (what: string) => z.string().nullable().describe(`${what}; null when not given`);

export const ChildRefSchema = z
  .object({
    id: z.number().int().describe("Child id; pass it as child_id"),
    firstName: z.string(),
  })
  .describe("The child the result is for");
export type ChildRef = z.infer<typeof ChildRefSchema>;

export const ChildSchema = z.object({
  id: z.number().int().describe("Child id; pass it as child_id"),
  firstName: z.string(),
  schoolName: text("School name"),
  className: text("Class name"),
});
export type Child = z.infer<typeof ChildSchema>;

export const LessonSchema = z.object({
  id: z.string().describe("Stable id of this lesson occurrence"),
  title: z.string().describe("Subject or lesson name"),
  start: DateTimeSchema,
  end: DateTimeSchema,
  room: text("Room"),
  group: text("Teaching group"),
  teacher: text("Teacher"),
  note: text("Lesson description"),
});
export type Lesson = z.infer<typeof LessonSchema>;

export const CalendarEventSchema = z.object({
  id: z.string().describe("Stable id of this calendar entry"),
  kind: z.enum(["lesson", "event"]).describe("A timetable entry or a school event"),
  title: z.string(),
  allDay: z.boolean(),
  start: z.union([LocalDateSchema, DateTimeSchema]).describe("Date for date-only entries"),
  end: z.union([LocalDateSchema, DateTimeSchema]).describe("Date for date-only entries"),
  location: text("Room or place"),
  teacher: text("Teacher"),
  group: text("Teaching group"),
  category: text("Portal category, e.g. lesson or lunch"),
  note: text("Description"),
});
export type CalendarEvent = z.infer<typeof CalendarEventSchema>;

export const DishSchema = z.object({
  kind: text("Kind of meal, as the school names it"),
  description: z.string(),
});
export type Dish = z.infer<typeof DishSchema>;

export const LunchDaySchema = z.object({
  date: LocalDateSchema,
  weekday: z.number().int().min(1).max(7).describe("1 = Monday … 7 = Sunday"),
  dishes: z.array(DishSchema),
});
export type LunchDay = z.infer<typeof LunchDaySchema>;

export const MessageSchema = z.object({
  id: z.number().int().describe("Message id; pass it to get_message"),
  subject: z.string(),
  preview: z.string().describe("Start of the message text"),
  read: z.boolean(),
  sender: z.object({ name: z.string() }).nullable(),
  sentAt: DateTimeSchema,
  hasAttachments: z.boolean(),
});
export type Message = z.infer<typeof MessageSchema>;
