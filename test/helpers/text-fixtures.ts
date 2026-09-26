/**
 * Synthetic results of the five typed operations for the text-view tests.
 * Invented names and places only; no real child's data.
 */
import type { CalendarEvent, Child, Lesson, LunchDay, Message } from "../../src/core/index.js";

const lesson = (
  title: string,
  start: string,
  end: string,
  room: string | null,
  id = `lesson:${title}@${start}`,
): Lesson => ({ id, title, start, end, room, group: "4B", teacher: "Lärare Test", note: null });

export const CHILDREN: { guardianName: string; children: Child[]; childInFocus: number } = {
  guardianName: "Test Testsson",
  children: [
    { id: 100, firstName: "Ett", schoolName: "Testskolan", className: "4B" },
    { id: 101, firstName: "Två", schoolName: "Östra Påhittade skolan", className: null },
  ],
  childInFocus: 101,
};

/** Week 36 2026, deliberately out of order. */
export const SCHEDULE = {
  week: 36,
  child: { id: 100, firstName: "Ett" },
  lessons: [
    lesson("Svenska", "2026-08-31T10:10:00+02:00", "2026-08-31T11:30:00+02:00", "B03"),
    lesson("Matematik", "2026-08-31T08:30:00+02:00", "2026-08-31T09:50:00+02:00", "A12"),
    lesson(
      "Idrott och hälsa",
      "2026-09-01T13:00:00+02:00",
      "2026-09-01T14:30:00+02:00",
      "Gymnastiksalen",
    ),
    lesson("Engelska", "2026-09-02T09:00:00+02:00", "2026-09-02T10:00:00+02:00", null),
  ] as Lesson[],
};

/** Week 44 2026, the first week after the autumn change (+01:00), one value given in UTC. */
export const SCHEDULE_AFTER_DST = {
  week: 44,
  child: { id: 100, firstName: "Ett" },
  lessons: [
    lesson("Matematik", "2026-10-26T08:30:00+01:00", "2026-10-26T09:50:00+01:00", "A12"),
    lesson("Svenska", "2026-10-26T09:10:00Z", "2026-10-26T10:30:00Z", "B03"),
    lesson("Lägerskola", "2026-10-27T20:00:00+01:00", "2026-10-28T08:00:00+01:00", null),
  ],
};

const event = (e: Partial<CalendarEvent> & Pick<CalendarEvent, "title" | "start" | "end">) =>
  ({
    id: `event:${e.title}@${e.start}`,
    kind: "event",
    allDay: false,
    location: null,
    teacher: null,
    group: null,
    category: null,
    note: null,
    ...e,
  }) as CalendarEvent;

export const CALENDAR = {
  startDate: "2026-10-19",
  endDate: "2026-10-25",
  timezone: "Europe/Stockholm",
  child: { id: 100, firstName: "Ett" },
  events: [
    event({
      title: "Matematik",
      kind: "lesson",
      start: "2026-10-19T08:30:00+02:00",
      end: "2026-10-19T09:50:00+02:00",
      location: "A12",
    }),
    event({ title: "Studiedag", start: "2026-10-19", end: "2026-10-19", allDay: true }),
    event({
      title: "Friluftsdag",
      start: "2026-10-20T00:00:00+02:00",
      end: "2026-10-20T23:59:00+02:00",
      allDay: true,
      location: "Skogen",
    }),
    event({ title: "Höstlov", start: "2026-10-23", end: "2026-10-25" }),
    event({
      title: "Nattvandring (sommartid)",
      start: "2026-10-25T02:30:00+02:00",
      end: "2026-10-25T02:45:00+02:00",
    }),
    event({
      title: "Nattvandring (vintertid)",
      start: "2026-10-25T02:30:00+01:00",
      end: "2026-10-25T02:45:00+01:00",
    }),
    event({
      title: "Midnattsfika",
      start: "2026-10-21T00:30:00+02:00",
      end: "2026-10-21T01:00:00+02:00",
      location: "Matsalen",
    }),
  ],
};

export const LUNCH: {
  year: number;
  week: number;
  child: { id: number; firstName: string };
  days: LunchDay[];
} = {
  year: 2026,
  week: 36,
  child: { id: 100, firstName: "Ett" },
  days: [
    {
      date: "2026-08-31",
      weekday: 1,
      dishes: [
        { kind: "Lunch", description: "Köttbullar med potatismos" },
        { kind: "Vegetarisk", description: "Linsbiffar" },
      ],
    },
    { date: "2026-09-02", weekday: 3, dishes: [{ kind: null, description: "Fiskgratäng" }] },
    { date: "2026-09-03", weekday: 4, dishes: [] },
    { date: "2026-09-04", weekday: 5, dishes: [{ kind: " ", description: "Pannkakor" }] },
    { date: "2026-09-05", weekday: 6, dishes: [{ kind: "Helg", description: "Soppa" }] },
  ],
};

export const INBOX: { messages: Message[] } = {
  messages: [
    {
      id: 7,
      subject: "Utflykt på fredag",
      preview: "Hej!",
      read: false,
      sender: { name: "Åsa Lärare" },
      sentAt: "2026-09-03T16:45:00+02:00",
      hasAttachments: true,
    },
    {
      id: 6,
      subject: "Veckobrev",
      preview: "Veckans nyheter",
      read: true,
      sender: null,
      sentAt: "2026-08-28T09:00:00+02:00",
      hasAttachments: false,
    },
    {
      id: 5,
      subject: "Föräldramöte\n\u001b[31mnästa vecka",
      preview: "",
      read: false,
      sender: { name: "Rektor Test" },
      sentAt: "2026-08-27T22:30:00Z",
      hasAttachments: false,
    },
  ],
};
