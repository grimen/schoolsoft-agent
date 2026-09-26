/**
 * What `make capture` records, declared once: the pages whose form
 * structure the write specs guessed at, the GDPR-gated Översikt page that
 * has no fixture yet, and the school-event agenda that was only ever seen
 * empty. Each names the fixture it becomes after review and promotion.
 * The absence REST endpoint is deliberately absent: it is a write.
 */
export interface PageCapture {
  readonly key: string;
  /** Path under the tenant. */
  readonly path: string;
  /** Behind the GDPR gate: needs the web-login session. */
  readonly web: boolean;
  /** `forms`: form structure only (JSON); `html`: the redacted page. */
  readonly kind: "forms" | "html";
  /** Where the reviewed file goes, relative to the repository root. */
  readonly fixture: string;
}

export interface AgendaCapture {
  readonly key: string;
  readonly path: string;
  readonly fixture: string;
  /** Date windows tried in turn, as [days before today, days after today], until one is non-empty. */
  readonly windows: readonly (readonly [number, number])[];
}

export interface CaptureTargets {
  readonly pages: readonly PageCapture[];
  readonly agenda: AgendaCapture;
}

export const CAPTURE_TARGETS: CaptureTargets = {
  pages: [
    {
      key: "absenceForm",
      path: "/jsp/student/right_student_absence.jsp",
      web: false,
      kind: "forms",
      fixture: "test/fixtures/forms/right_student_absence.jsp.json",
    },
    {
      key: "leaveForm",
      path: "/jsp/student/right_student_studentleave.jsp",
      web: false,
      kind: "forms",
      fixture: "test/fixtures/forms/right_student_studentleave.jsp.json",
    },
    {
      key: "messageForm",
      path: "/jsp/student/right_student_message.jsp",
      web: false,
      kind: "forms",
      fixture: "test/fixtures/forms/right_student_message.jsp.json",
    },
    {
      key: "overview",
      path: "/jsp/student/right_student_lesson_status.jsp",
      web: true,
      kind: "html",
      fixture: "test/fixtures/jsp/right_student_lesson_status.jsp.html",
    },
  ],
  agenda: {
    key: "eventAgenda",
    path: "/rest-api/parent/calendar/event/agenda",
    fixture: "test/fixtures/api/calendar-event-agenda.json",
    // The second window stays under the 366-day span get_calendar allows.
    windows: [
      [7, 60],
      [120, 240],
    ],
  },
};
