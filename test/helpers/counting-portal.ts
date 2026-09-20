/**
 * A complete Portal whose every answer names the child it was read for and
 * how many reads came before it, so a test can tell a cached answer from a
 * new one and one child's data from another's.
 */
import type {
  ActivityEntry,
  Booking,
  ContactGroup,
  GuardianParent,
  Portal,
  PortalFile,
  SubjectRoom,
  TablePage,
} from "../../src/core/index.js";

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
    return { title: await this.read(name, args), sections: [] };
  }

  async getParent(): Promise<GuardianParent> {
    return { userId: 21, firstName: await this.read("getParent", []), lastName: "", children: [] };
  }
  async getLunchWeek(orgId: number, week: number): Promise<unknown[]> {
    return [await this.read("getLunchWeek", [orgId, week])];
  }
  async getNews(userId: number, orgId: number, studentId: number): Promise<unknown[]> {
    return [await this.read("getNews", [userId, orgId, studentId])];
  }
  async getInbox(userId: number, orgId: number): Promise<unknown[]> {
    return [await this.read("getInbox", [userId, orgId])];
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
  async getScheduleWeek(week: number): Promise<unknown[]> {
    return [await this.read("getScheduleWeek", [week])];
  }
  async getCalendar(startDate: string, endDate: string): Promise<unknown[]> {
    return [await this.read("getCalendar", [startDate, endDate])];
  }
  async getAssignmentsWeek(week: number, year: number): Promise<unknown[]> {
    return [await this.read("getAssignmentsWeek", [week, year])];
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
    const subject = await this.read("getSubjectRooms", []);
    return [{ subject, subjectId: 1, groups: [], teachers: [] }];
  }
  async getBookings(): Promise<Booking[]> {
    return [{ title: await this.read("getBookings", []), slots: [] }];
  }
  async getFiles(): Promise<PortalFile[]> {
    return [{ name: await this.read("getFiles", []), url: "https://example.test/f", type: "file" }];
  }
  getGrades(): Promise<TablePage> {
    return this.page("getGrades", []);
  }
  getStudentDocuments(): Promise<TablePage> {
    return this.page("getStudentDocuments", []);
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
}
