/**
 * Shared test doubles: a guardian context with two children, a fake
 * Portal, a fake auth strategy, and a context factory that wires them
 * into a real SessionManager (memory store, no network).
 */
import {
  SessionManager,
  MemorySessionStore,
  type AuthStrategy,
  type LoginInfo,
  type PersistedSession,
  type Portal,
  type GuardianContext,
  type OperationContext,
  type Config,
  type ProviderSession,
  createCompositePortal,
} from "../../src/core/index.js";
import type { CalendarEvent, Lesson, Message } from "../../src/core/domain/schemas.js";
import { isoWeekDate } from "../../src/core/domain/time.js";
import { schoolsoftProvider, ROUTING } from "../../src/providers/schoolsoft/index.js";

const lesson = (id: string, title: string, start: string, end: string, room: string): Lesson => ({
  id,
  title,
  start,
  end,
  room,
  group: "4B",
  teacher: "Lärare Test",
  note: null,
});

/** Domain lessons, as a provider returns them after mapping. */
export const FAKE_LESSONS: Lesson[] = [
  lesson(
    "lesson:1@2026-08-31T08:30:00+02:00",
    "Matematik",
    "2026-08-31T08:30:00+02:00",
    "2026-08-31T09:50:00+02:00",
    "A12",
  ),
  lesson(
    "lesson:2@2026-08-31T10:10:00+02:00",
    "Svenska",
    "2026-08-31T10:10:00+02:00",
    "2026-08-31T11:30:00+02:00",
    "B03",
  ),
];

export const CONTEXT: GuardianContext = {
  userId: 21,
  parentName: "Test Testsson",
  childInFocus: 100,
  children: [
    {
      studentId: 100,
      firstName: "Ett",
      lastName: "T",
      schools: [{ orgId: 20, name: "Testskolan", className: "4B" }],
    },
    {
      studentId: 101,
      firstName: "Två",
      lastName: "T",
      schools: [{ orgId: 20, name: "Testskolan", className: "1A" }],
    },
  ],
};

/** A provider-neutral fake session: what core needs plus the credentials the fake serializer persists. */
export interface FakeSession extends ProviderSession {
  accessToken: string | null;
  refreshToken: string | null;
}

export function fakeSession(overrides: Partial<FakeSession> = {}): FakeSession {
  return {
    school: "testskola",
    accessToken: "tok",
    refreshToken: "ref",
    verify: async () => true,
    cookieHeader: () => "JSESSIONID=x; hash=y; usertype=2",
    ...overrides,
  };
}

export const serializeFake = (s: FakeSession): Record<string, unknown> => ({
  ...(s.accessToken ? { accessToken: s.accessToken } : {}),
  ...(s.refreshToken ? { refreshToken: s.refreshToken } : {}),
});

export const fakePortal = {
  getScheduleWeek: async (_week: number) => FAKE_LESSONS,
  getCalendar: async (_start: string, _end: string): Promise<CalendarEvent[]> =>
    FAKE_LESSONS.map((l) => ({
      id: l.id,
      kind: "lesson",
      title: l.title,
      allDay: false,
      start: l.start,
      end: l.end,
      location: l.room,
      teacher: l.teacher,
      group: l.group,
      category: "lesson",
      note: null,
    })),
  getLunchWeek: async (_org: number, week: number, year: number) => [
    {
      date: isoWeekDate(year, week, 5),
      weekday: 5,
      dishes: [{ kind: "Lunch", description: "Spagetti" }],
    },
  ],
  getAssignmentsWeek: async () => [{ id: 7, title: "Läxa" }],
  getAssignmentDetail: async (id: number) => ({ view: { id }, sections: [] }),
  getNews: async () => [{ id: 1, title: "Studiedag fredag" }],
  getInbox: async (): Promise<Message[]> => [
    {
      id: 5,
      subject: "Hej",
      preview: "Hej!",
      read: false,
      sender: { name: "Lärare Test" },
      sentAt: "2026-09-01T14:05:00+02:00",
      hasAttachments: false,
    },
    {
      id: 6,
      subject: "Läst",
      preview: "Redan läst",
      read: true,
      sender: null,
      sentAt: "2026-08-28T09:00:00+02:00",
      hasAttachments: true,
    },
  ],
  getMessage: async (_u: number, _o: number, id: number) => ({ id, message: "Full text" }),
  getActivityLog: async (limit = 20) =>
    [{ id: 1, date: "2026-09-01", title: "Utflykt", text: "Vi var i skogen.", comments: 0 }].slice(
      0,
      limit,
    ),
  getContacts: async () => [
    { title: "Elever", people: [{ name: "Test Elev", role: "Elev", email: "e@example.test" }] },
  ],
  getSubjectRooms: async () => [
    { subject: "Matematik", subjectId: 1, groups: ["4B"], teachers: ["Lärare Test"] },
  ],
  getBookings: async () => [
    { title: "Utvecklingssamtal", slots: [{ start: "2026-10-01 15:00", status: "available" }] },
  ],
  getFiles: async () => [
    { name: "Veckobrev", url: "https://example.test/veckobrev.pdf", type: "file" },
  ],
  // GDPR-gated (web session) capabilities
  getGrades: async () => ({ title: "Betyg", sections: [] }),
  getStudentDocuments: async () => ({
    title: "Elevdokument",
    sections: [
      {
        heading: "Arkiverade elevdokument",
        headers: ["Rubrik", "Skapad av", "Datum", ""],
        rows: [
          {
            cells: ["IUP", "Lärare Test", "2026-01-10", ""],
            url: "right_student_review.jsp?action=view&archive=1&requestid=1",
          },
        ],
      },
    ],
  }),
  getUnreportedAbsence: async () => ({
    title: "Oanmäld frånvaro",
    message: "Det finns ingen oanmäld frånvaro att ta del av",
    sections: [],
  }),
  getAttendanceReport: async () => ({
    title: "Närvarorapport",
    sections: [
      { headers: ["Orsak", "Lektioner", "Timmar"], rows: [{ cells: ["Sjuk", "2", "1"] }] },
    ],
  }),
  getAssessmentCriteria: async (subject: string) => ({
    title: `Kriterier ${subject}`,
    sections: [{ headers: ["Förmåga", "E", "C", "A"], rows: [{ cells: ["Läsa", "…", "…", "…"] }] }],
  }),
  getGradePrognosis: async () => ({ reconciliationDates: [] }),
  reportAbsence: async () => ({ status: 200, response: { synthetic: true } }),
} as unknown as Portal;

export class FakeAuth implements AuthStrategy<FakeSession> {
  readonly id = "fake";
  context?: GuardianContext;
  loginCalls = 0;
  async login(_s: FakeSession): Promise<LoginInfo> {
    this.loginCalls++;
    this.context = { ...CONTEXT };
    return { name: "Test Testsson", schoolName: "Testskolan", userType: "parent" };
  }
  async restore(_s: FakeSession, saved: PersistedSession): Promise<void> {
    this.context = saved.guardian ?? { ...CONTEXT };
  }
  renewCalls = 0;
  /** Set to make renew() fail (a NetworkError, a rejection...). */
  renewError: unknown = null;
  renewExpiresAt: number | null = null;
  async renew(): Promise<{ expiresAt: number | null }> {
    this.renewCalls++;
    if (this.renewError) throw this.renewError;
    return { expiresAt: this.renewExpiresAt };
  }
  async focusChild(_s: FakeSession, studentId: number): Promise<void> {
    // Deliberately non-validating: SessionManager must guard this.
    this.context = { ...this.context!, childInFocus: studentId };
  }
}

export const testConfig: Config = {
  provider: "schoolsoft",
  school: "testskola",
  userType: "parent",
  clientId: "vApp",
  callbackPort: 43117,
  stateDir: "/tmp/unused",
  configDir: "/tmp/unused",
  browser: { kind: "chromium", headless: true },
  cache: true,
  keepalive: { mode: "off", webIntervalMs: 600_000, quietHours: null },
  allowWrites: false,
};

export function makeContext(
  opts: {
    browserUnavailable?: string;
    webLogin?: (school: string) => Promise<import("../../src/core/index.js").WebSession>;
    store?: MemorySessionStore;
    portal?: Portal;
    config?: Partial<Config>;
    pending?: import("../../src/core/index.js").PendingLoginStore;
  } = {},
) {
  const store = opts.store ?? new MemorySessionStore();
  const strategy = new FakeAuth();
  const manager = new SessionManager<FakeSession>({
    school: "testskola",
    store,
    strategies: [strategy],
    createSession: () => fakeSession(),
    serialize: serializeFake,
    webLogin: opts.webLogin,
    pending: opts.pending,
    pid: 1,
  });
  const logs: string[] = [];
  const ctx: OperationContext = {
    manager: manager as unknown as SessionManager,
    provider: schoolsoftProvider as never,
    portal:
      opts.portal ??
      (opts.browserUnavailable
        ? createCompositePortal({
            routing: ROUTING,
            providerId: "schoolsoft",
            api: fakePortal as never,
            browser: null,
            browserUnavailableReason: opts.browserUnavailable,
          })
        : fakePortal),
    config: { ...testConfig, ...opts.config },
    log: (m) => logs.push(m),
  };
  return { ctx, manager, store, strategy, logs };
}
