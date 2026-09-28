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

/** Text the portal words itself (a status, a role); null when not given. */
const label = (what: string) =>
  z.string().nullable().describe(`${what}, as the portal words it; null when not given`);

export const AssignmentSchema = z.object({
  id: z.number().int().describe("Assignment id; pass it to get_assignment_detail"),
  title: z.string(),
  subtitle: text("Subtitle"),
  subjectRoomId: z.string().describe("Id of the subject room it belongs to (SubjectRoom.id)"),
  date: z
    .union([LocalDateSchema, DateTimeSchema])
    .describe("The date the portal lists it under; a date when no time is given"),
  read: z.boolean(),
  submissionStatus: label("Submission status"),
  resultStatus: label("Result report status"),
});
export type Assignment = z.infer<typeof AssignmentSchema>;

export const NewsItemSchema = z.object({
  id: z.string().describe("Stable id of this news item"),
  title: z.string(),
  body: text("News text"),
  category: label("Category"),
  author: text("Author"),
  read: z.boolean(),
  hasAttachments: z.boolean(),
  publishedAt: DateTimeSchema,
  visibleUntil: z
    .union([LocalDateSchema, DateTimeSchema])
    .nullable()
    .describe("When the item stops being shown; null when not given"),
});
export type NewsItem = z.infer<typeof NewsItemSchema>;

export const SubjectRoomSchema = z.object({
  id: z.string().describe("Stable id of this subject room"),
  name: z.string().describe("Subject"),
  groups: z.array(z.string()).describe("Classes or teaching groups the room belongs to"),
  teachers: z.array(z.object({ name: z.string(), role: label("Role") })),
});
export type SubjectRoom = z.infer<typeof SubjectRoomSchema>;

export const BookingSchema = z.object({
  id: z.string().describe("Stable id of this booking"),
  title: z.string(),
  description: text("Description"),
  start: z
    .union([LocalDateSchema, DateTimeSchema])
    .describe("When it starts; a date when the page gives no time"),
  end: DateTimeSchema.nullable().describe("When it ends; null when the page gives no end"),
  status: z
    .enum(["available", "booked", "closed", "unknown"])
    .describe("Read from the page's wording; unknown when it says none of these"),
  details: z
    .array(z.object({ label: z.string(), value: z.string() }))
    .describe("Label and value pairs shown beside the booking, in page order"),
});
export type Booking = z.infer<typeof BookingSchema>;

export const SharedFileSchema = z.object({
  id: z.string().describe("Stable id of this file or link"),
  name: z.string(),
  url: z
    .url({ protocol: /^https?$/ })
    .nullable()
    .describe(
      "Absolute http(s) link; file links need the portal session. null when the portal's link is not http(s)",
    ),
  kind: z.enum(["file", "link"]).describe("A document stored in the portal, or a link elsewhere"),
  category: text("Heading the portal lists it under"),
});
export type SharedFile = z.infer<typeof SharedFileSchema>;

export const TableSectionSchema = z.object({
  heading: text("Heading above the table"),
  headers: z.array(z.string()).describe("Column headings, as the page words them"),
  rows: z.array(
    z.object({
      cells: z.array(z.string()).describe("Cell texts, one per column"),
      link: text("The row's link"),
    }),
  ),
});
export type TableSection = z.infer<typeof TableSectionSchema>;

export const TablePageSchema = z
  .object({
    title: z.string(),
    message: text("Notice shown instead of, or above, the tables"),
    sections: z.array(TableSectionSchema),
  })
  .describe("A page of tables as the portal shows it; cell meanings are the page's own");
export type TablePage = z.infer<typeof TablePageSchema>;

export const StudentDocumentSchema = z.object({
  id: z.string().describe("Stable id of this document"),
  title: z.string(),
  createdBy: text("Who created it"),
  date: LocalDateSchema,
  archived: z.boolean(),
  link: z.string().describe("The document's page in the portal; it needs the web login"),
});
export type StudentDocument = z.infer<typeof StudentDocumentSchema>;
