/**
 * Shared test doubles: a guardian context with two children, a fake
 * GuardianApi, a fake auth strategy, and a context factory that wires them
 * into a real SessionManager (memory store, no network).
 */
import type { SchoolsoftClient } from "@elias4044/ssp-node";
import {
  SessionManager,
  MemorySessionStore,
  type AuthStrategy,
  type LoginInfo,
  type PersistedSession,
  type GuardianApi,
  type GuardianContext,
  type OperationContext,
  type Config,
} from "../../src/core/index.js";

export const FAKE_LESSONS = [
  { name: "Matematik", startDate: "2026-08-31T08:30", endDate: "2026-08-31T09:50", room: "A12" },
  { name: "Svenska", startDate: "2026-08-31T10:10", endDate: "2026-08-31T11:30", room: "B03" },
];

export const CONTEXT: GuardianContext = {
  userId: 21,
  parentName: "Test Testsson",
  childInFocus: 100,
  children: [
    { studentId: 100, firstName: "Ett", lastName: "T", schools: [{ orgId: 20, name: "Testskolan", className: "4B" }] },
    { studentId: 101, firstName: "Två", lastName: "T", schools: [{ orgId: 20, name: "Testskolan", className: "1A" }] },
  ],
};

export function fakeSchoolsoftClient(overrides: Partial<SchoolsoftClient> = {}): SchoolsoftClient {
  return {
    school: "testskola",
    accessToken: "tok",
    refreshToken: "ref",
    cookieHeader: "JSESSIONID=x; hash=y; usertype=2",
    verifySession: async () => true,
    ...overrides,
  } as unknown as SchoolsoftClient;
}

export const fakeApi = {
  getScheduleWeek: async (_week: number) => FAKE_LESSONS,
  getLunchWeek: async (_org: number, week: number) => [
    { week, dayId: 5, dishes: [{ mealType: "Lunch", description: "Spagetti" }] },
  ],
  getAssignmentsWeek: async () => [{ id: 7, title: "Läxa" }],
  getAssignmentDetail: async (id: number) => ({ view: { id }, sections: [] }),
  getNews: async () => [{ id: 1, title: "Studiedag fredag" }],
  getInbox: async () => [
    { id: 5, subject: "Hej", isRead: false },
    { id: 6, subject: "Läst", isRead: true },
  ],
  getMessage: async (_u: number, _o: number, id: number) => ({ id, message: "Full text" }),
} as unknown as GuardianApi;

export class FakeAuth implements AuthStrategy {
  readonly id = "fake";
  context?: GuardianContext;
  loginCalls = 0;
  async login(_c: SchoolsoftClient): Promise<LoginInfo> {
    this.loginCalls++;
    this.context = { ...CONTEXT };
    return { name: "Test Testsson", schoolName: "Testskolan", userType: "parent" };
  }
  async restore(_c: SchoolsoftClient, saved: PersistedSession): Promise<void> {
    this.context = saved.guardian ?? { ...CONTEXT };
  }
  async focusChild(_c: SchoolsoftClient, studentId: number): Promise<void> {
    // Deliberately non-validating: SessionManager must guard this.
    this.context = { ...this.context!, childInFocus: studentId };
  }
}

export const testConfig: Config = {
  school: "testskola",
  userType: "parent",
  clientId: "vApp",
  callbackPort: 43117,
  stateDir: "/tmp/unused",
  configDir: "/tmp/unused",
};

export function makeContext(opts: { store?: MemorySessionStore; api?: GuardianApi; config?: Partial<Config> } = {}) {
  const store = opts.store ?? new MemorySessionStore();
  const strategy = new FakeAuth();
  const manager = new SessionManager({
    school: "testskola",
    store,
    strategies: [strategy],
    clientFactory: () => fakeSchoolsoftClient(),
  });
  const logs: string[] = [];
  const ctx: OperationContext = {
    manager,
    api: opts.api ?? fakeApi,
    config: { ...testConfig, ...opts.config },
    log: (m) => logs.push(m),
  };
  return { ctx, manager, store, strategy, logs };
}
