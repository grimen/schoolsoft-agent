/**
 * Frånvaroanmälan: the one write backend so far. `POST
 * /rest-api/parent/absence-notice` with the APP session cookies (bound to
 * the child in focus, like the rest of the webview REST). Sends exactly one
 * request per call and never retries: after a transport failure or a 5xx the
 * report may already be registered, so the error says the outcome is unknown
 * instead of inviting a repeat. 401/403 pass through unchanged so session
 * recovery can renew the session (it does not repeat writes either). The
 * request budget never retries; a 429 answer is "outcome unknown" too (this
 * client cannot be sure what an unofficial endpoint did), and a request the
 * budget refused while the portal pushes back was never sent and says so.
 *
 * The endpoint is known to exist; its body is not. See absence-notice-body.ts.
 */
import type { AbsenceNotice, AbsenceReceipt } from "../../../../core/portal/types.js";
import {
  AgentError,
  NetworkError,
  PortalPushbackError,
  UpstreamError,
} from "../../../../core/errors/index.js";
import { toAbsenceNoticeBody } from "./absence-notice-body.js";
import type { SchoolsoftHttp } from "./transport.js";

export const ABSENCE_NOTICE_PATH = "/rest-api/parent/absence-notice";

export class AbsenceApi {
  constructor(
    private readonly http: SchoolsoftHttp,
    private readonly cookieHeader: () => string | null,
  ) {}

  async reportAbsence(notice: AbsenceNotice): Promise<AbsenceReceipt> {
    const cookie = this.cookieHeader();
    if (!cookie)
      throw new AgentError({
        kind: "not_authenticated",
        key: "not_authenticated",
        params: { reason: "no session cookies" },
        hint: "login",
      });
    try {
      const r = await this.http.postWrite(ABSENCE_NOTICE_PATH, cookie, toAbsenceNoticeBody(notice));
      return { status: r.status, response: r.data };
    } catch (e) {
      throw writeFailure(e);
    }
  }
}

function writeFailure(e: unknown): unknown {
  const unknownOutcome = (detail: string, kind: "network" | "upstream") =>
    new AgentError({
      kind,
      key: "write_outcome_unknown",
      params: { detail, what: "the absence report" },
      hint: "check_portal",
      retryable: false,
      cause: e,
    });
  if (e instanceof NetworkError) return unknownOutcome(e.params.detail, "network");
  if (e instanceof PortalPushbackError) return e.sent ? unknownOutcome("HTTP 429", "upstream") : e;
  if (!(e instanceof UpstreamError) || e.sessionRejected) return e;
  if (e.status >= 500) return unknownOutcome(`HTTP ${e.status}`, "upstream");
  return new AgentError({
    kind: "upstream",
    key: "absence_rejected",
    params: { status: e.status },
    hint: "fix_input",
    cause: e,
  });
}
