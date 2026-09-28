/**
 * A complete Portal whose every answer names the child it was read for and
 * how many reads came before it, so a test can tell a cached answer from a
 * new one and one child's data from another's.
 */
import type {
  AbsenceNotice,
  AbsenceReceipt,
  ActivityEntry,
  ContactGroup,
  GuardianParent,
  Portal,
} from "../../src/core/index.js";
import type {
  Assignment,
  Booking,
  CalendarEvent,
  Lesson,
  LunchDay,
  Message,
  NewsItem,
  SharedFile,
  StudentDocument,
  SubjectRoom,
  TablePage,
} from "../../src/core/domain/schemas.js";

/** A domain lesson whose title is the read's marker. */
export function markedLesson(title: string): Lesson {
  return {
    id: `lesson:${title}`,
    title,
    start: "2026-09-07T08:30:00+02:00",
    end: "2026-09-07T09:30:00+02:00",
    room: null,
    group: null,
    teacher: null,
    note: null,
  };
}

export class CountingPortal implements Portal {
  readonly calls: string[] = [];
  /** Awaited inside every read, so a test can interleave something with it. */
  during: (() => Promise<void> | void) | null = null;
  /** Thrown by the next read, once. */
  failNext: Error | null = null;

  constructor(private readonly child: () => number) {}

  private async read(name: string, args: unknown[]): Promise<string> {
    const child = this.child(); // upstream answers for the child in focus when the read starts
    this.calls.push(`${name}(${args.map((a) => String(a)).join(",")})@${child}`);
    const n = this.calls.length;
    if (this.failNext) {
      const e = this.failNext;
      this.failNext = null;
      throw e;
    }
    await this.during?.();
    return `child ${child} ${name} #${n}`;
  }
  private async page(name: string, args: unknown[]): Promise<TablePage> {
    return { title: await this.read(name, args), message: null, sections: [] };
  }

  async getParent(): Promise<GuardianParent> {
    return { userId: 21, firstName: await this.read("getParent", []), lastName: "", children: [] };
  }
  async getLunchWeek(orgId: number, week: number, year: number): Promise<LunchDay[]> {
    const description = await this.read("getLunchWeek", [orgId, week, year]);
    return [{ date: "2026-09-07", weekday: 1, dishes: [{ kind: null, description }] }];
  }
  async getNews(userId: number, orgId: number, studentId: number): Promise<NewsItem[]> {
    const title = await this.read("getNews", [userId, orgId, studentId]);
    return [
      {
        id: `news:${title}`,
        title,
        body: null,
        category: null,
        author: null,
        read: false,
        hasAttachments: false,
        publishedAt: "2026-09-07T08:30:00+02:00",
        visibleUntil: null,
      },
    ];
  }
  async getInbox(userId: number, orgId: number): Promise<Message[]> {
    const subject = await this.read("getInbox", [userId, orgId]);
    return [
      {
        id: 1,
        subject,
        preview: "",
        read: false,
        sender: null,
        sentAt: "2026-09-07T08:30:00+02:00",
        hasAttachments: false,
      },
    ];
  }
  async getMessage(userId: number, orgId: number, messageId: number): Promise<unknown> {
    return this.read("getMessage", [userId, orgId, messageId]);
  }
  async getNextCalendarEvent(userId: number, orgId: number, studentId: number): Promise<unknown> {
    return this.read("getNextCalendarEvent", [userId, orgId, studentId]);
  }
  async getSession(): Promise<unknown> {
    return this.read("getSession", []);
  }
  async getScheduleWeek(week: number): Promise<Lesson[]> {
    return [markedLesson(await this.read("getScheduleWeek", [week]))];
  }
  async getCalendar(startDate: string, endDate: string): Promise<CalendarEvent[]> {
    const title = await this.read("getCalendar", [startDate, endDate]);
    return [
      {
        id: `lesson:${title}`,
        kind: "lesson",
        title,
        allDay: false,
        start: startDate,
        end: endDate,
        location: null,
        teacher: null,
        group: null,
        category: null,
        note: null,
      },
    ];
  }
  async getAssignmentsWeek(week: number, year: number): Promise<Assignment[]> {
    const title = await this.read("getAssignmentsWeek", [week, year]);
    return [
      {
        id: 1,
        title,
        subtitle: null,
        subjectRoomId: "subject-room:1",
        date: "2026-09-07",
        read: false,
        submissionStatus: null,
        resultStatus: null,
      },
    ];
  }
  async getAssignmentDetail(id: number): Promise<{ view: unknown; sections: unknown }> {
    return { view: await this.read("getAssignmentDetail", [id]), sections: [] };
  }
  async getActivityLog(limit?: number): Promise<ActivityEntry[]> {
    const text = await this.read("getActivityLog", [limit]);
    return [{ id: 1, date: "2026-09-01", title: "t", text, comments: 0 }];
  }
  async getContacts(): Promise<ContactGroup[]> {
    return [{ title: await this.read("getContacts", []), people: [] }];
  }
  async getSubjectRooms(): Promise<SubjectRoom[]> {
    const name = await this.read("getSubjectRooms", []);
    return [{ id: "subject-room:1", name, groups: [], teachers: [] }];
  }
  async getBookings(): Promise<Booking[]> {
    const title = await this.read("getBookings", []);
    return [
      {
        id: `booking:${title}`,
        title,
        description: null,
        start: "2026-10-01",
        end: null,
        status: "unknown",
        details: [],
      },
    ];
  }
  async getFiles(): Promise<SharedFile[]> {
    const name = await this.read("getFiles", []);
    return [{ id: "file:1", name, url: "https://example.test/f", kind: "file", category: null }];
  }
  getGrades(): Promise<TablePage> {
    return this.page("getGrades", []);
  }
  async getStudentDocuments(): Promise<StudentDocument[]> {
    const title = await this.read("getStudentDocuments", []);
    return [
      {
        id: "document:1",
        title,
        createdBy: null,
        date: "2026-01-10",
        archived: false,
        link: "right_student_review.jsp?requestid=1",
      },
    ];
  }
  getUnreportedAbsence(): Promise<TablePage> {
    return this.page("getUnreportedAbsence", []);
  }
  getAttendanceReport(): Promise<TablePage> {
    return this.page("getAttendanceReport", []);
  }
  getAssessmentCriteria(subject: string, schoolType?: number): Promise<TablePage> {
    return this.page("getAssessmentCriteria", [subject, schoolType]);
  }
  async getGradePrognosis(): Promise<{ reconciliationDates: unknown }> {
    return { reconciliationDates: await this.read("getGradePrognosis", []) };
  }
  /** A write: counted like a read so a test can see it is never cached or repeated. */
  async reportAbsence(notice: AbsenceNotice): Promise<AbsenceReceipt> {
    return { status: 200, response: await this.read("reportAbsence", [notice.startDate]) };
  }
}
