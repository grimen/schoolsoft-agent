/**
 * How long a read may be answered from memory, per capability. Conservative
 * on purpose: a capability that is absent is never cached. Web-session
 * (GDPR-gated) capabilities are refused by the cache decorator whatever this
 * table says; see docs/planning/specs/2026-09-21-session-longevity.md.
 */
import type { Capability } from "../portal/types.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export type CacheTtls = Partial<Record<Capability, number>>;

export const DEFAULT_CACHE_TTL_MS: CacheTtls = {
  // Published weekly, or changes a few times a term.
  getLunchWeek: 6 * HOUR,
  getSubjectRooms: 6 * HOUR,
  getContacts: 6 * HOUR,
  getFiles: HOUR,
  // Substitutions and cancelled lessons happen during the day.
  getScheduleWeek: 30 * MINUTE,
  getCalendar: 30 * MINUTE,
  // Feeds: long enough for the follow-up question in the same conversation.
  getNews: 10 * MINUTE,
  getAssignmentsWeek: 10 * MINUTE,
  getAssignmentDetail: 10 * MINUTE,
  getActivityLog: 10 * MINUTE,
};
