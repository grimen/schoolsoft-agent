/**
 * `doctor --verify`: run every typed read operation once against the live
 * portal and report whether its answer still maps, without keeping or showing
 * any of it. The registry decides what is verified (operations that declare
 * `output` and only read), each runs through `runOperation` with its own
 * defaults plus `fresh: true`, so the cache cannot hide drift. Results carry
 * statuses, positions, drift paths and issue codes, error kinds and message
 * keys: never a value, a name or an id. See
 * docs/planning/specs/2026-09-26-doctor-verify.md.
 */
import { operations as registry } from "./registry.js";
import { runOperation } from "./run.js";
import type { Operation, OperationContext } from "./types.js";
import { providerOf } from "../portal/composite.js";
import type { GuardianContext } from "../portal/guardian.js";
import {
  AgentError,
  EXIT_CODE_BY_KIND,
  ResponseDriftError,
  UpstreamError,
  type ErrorKind,
  type MessageKey,
} from "../errors/index.js";

/**
 * Typed read operations the check cannot call with `{}` plus `fresh`, by name,
 * with the reason. Reported as skipped. The registry test requires every other
 * verifiable operation to accept `{}`.
 */
export const VERIFY_EXCLUSIONS: Readonly<Record<string, string>> = {};

export type VerifyStatus = "ok" | "drift" | "skipped" | "error";
export type VerifySkipReason =
  "web_session_required" | "browser_not_installed" | "excluded" | "session_drift";

interface ResultBase {
  operation: string;
  /** 1-based position of the child in the account's list; absent for account-level operations. */
  child?: number;
}

export type VerifyResult =
  | (ResultBase & { status: "ok" })
  | (ResultBase & { status: "drift"; at: string; detail: string })
  | (ResultBase & { status: "skipped"; reason: VerifySkipReason; note?: string })
  | (ResultBase & {
      status: "error";
      kind: ErrorKind;
      code: MessageKey;
      retryable: boolean;
      httpStatus?: number;
    });

export interface VerifyDrift {
  status: "drift";
  at: string;
  detail: string;
}

export interface VerifyReport {
  /** True when nothing drifted and nothing failed (skips are fine). */
  ok: boolean;
  /** The session (and the guardian profile it reads) could be established, or drifted. */
  session: "ok" | VerifyDrift;
  /** How many children the account has and which positions were verified; null on session drift. */
  children: { total: number; verified: number[] } | null;
  summary: Record<VerifyStatus, number>;
  results: VerifyResult[];
}

export interface VerifyOperationsOptions {
  /** Verify every child, not only the one in focus. */
  allChildren?: boolean;
  /** Is the optional browser usable (the caller measured it; no probe runs here). */
  browserReady: boolean;
  /** Defaults to the registry. */
  operations?: readonly Operation[];
  /** Defaults to VERIFY_EXCLUSIONS. */
  exclusions?: Readonly<Record<string, string>>;
}

/** Declares a result shape, only reads, and needs a login: what the check calls. */
export function isVerifiable(op: Operation): boolean {
  const a = op.annotations;
  return op.output !== undefined && a.readOnly && !a.destructive && a.requiresAuth;
}

const childScoped = (op: Operation) => "child_id" in op.input;

function skipReason(
  op: Operation,
  ctx: OperationContext,
  options: VerifyOperationsOptions,
): Pick<Extract<VerifyResult, { status: "skipped" }>, "reason" | "note"> | null {
  const exclusions = options.exclusions ?? VERIFY_EXCLUSIONS;
  if (Object.hasOwn(exclusions, op.name)) return { reason: "excluded", note: exclusions[op.name] };
  const gated = op.portal.some((c) => ctx.provider.webSessionCapabilities.includes(c));
  if (gated && ctx.manager.getWebSession() === null) return { reason: "web_session_required" };
  const browser = op.portal.some((c) => providerOf(ctx.provider.routing, c) === "browser");
  if (browser && !options.browserReady) return { reason: "browser_not_installed" };
  return null;
}

async function verifyOne(
  op: Operation,
  ctx: OperationContext,
  options: VerifyOperationsOptions,
  /** The child's position for child-scoped operations; `childId` only when switching child. */
  scope: { position?: number; childId?: number } = {},
): Promise<VerifyResult> {
  const base: ResultBase =
    scope.position === undefined
      ? { operation: op.name }
      : { operation: op.name, child: scope.position };
  const skip = skipReason(op, ctx, options);
  if (skip) return { ...base, status: "skipped", ...skip };
  const args: Record<string, unknown> = {};
  if ("fresh" in op.input) args.fresh = true;
  if (scope.childId !== undefined) args.child_id = scope.childId;
  try {
    await runOperation(op, ctx, args); // the result is discarded unread
    return { ...base, status: "ok" };
  } catch (e) {
    if (e instanceof ResponseDriftError)
      return { ...base, status: "drift", at: e.where, detail: e.detail };
    if (e instanceof AgentError)
      return {
        ...base,
        status: "error",
        kind: e.kind,
        code: e.key,
        retryable: e.retryable,
        ...(e instanceof UpstreamError ? { httpStatus: e.status } : {}),
      };
    return { ...base, status: "error", kind: "internal", code: "internal", retryable: false };
  }
}

function buildReport(
  session: VerifyReport["session"],
  children: VerifyReport["children"],
  results: VerifyResult[],
): VerifyReport {
  const summary: Record<VerifyStatus, number> = { ok: 0, drift: 0, skipped: 0, error: 0 };
  for (const r of results) summary[r.status]++;
  return {
    ok: session === "ok" && summary.drift === 0 && summary.error === 0,
    session,
    children,
    summary,
    results,
  };
}

/**
 * Verify the typed read operations, sequentially, one request chain each.
 * Throws what establishing the session throws (not logged in, not configured,
 * network), before any operation runs; drift of the guardian profile is
 * reported instead. Never writes, never logs in.
 */
export async function verifyOperations(
  ctx: OperationContext,
  options: VerifyOperationsOptions,
): Promise<VerifyReport> {
  const selected = (options.operations ?? registry).filter(isVerifiable);
  let guardian: GuardianContext;
  try {
    await ctx.manager.ensureSession();
    guardian = ctx.manager.guardian();
  } catch (e) {
    if (!(e instanceof ResponseDriftError)) throw e;
    const skipped = selected.map((op): VerifyResult => ({
      operation: op.name,
      status: "skipped",
      reason: "session_drift",
    }));
    return buildReport({ status: "drift", at: e.where, detail: e.detail }, null, skipped);
  }

  const inFocus = guardian.childInFocus;
  const focusPosition = guardian.children.findIndex((c) => c.studentId === inFocus) + 1;
  const targets = options.allChildren
    ? guardian.children.map((c, i) => ({ childId: c.studentId, position: i + 1 }))
    : [];
  const results: VerifyResult[] = [];
  for (const op of selected.filter((o) => !childScoped(o)))
    results.push(await verifyOne(op, ctx, options));
  const perChild = selected.filter(childScoped);
  if (options.allChildren) {
    for (const target of targets)
      for (const op of perChild) results.push(await verifyOne(op, ctx, options, target));
    // The child in focus is persisted: a check must not change what later commands default to.
    await ctx.manager.focusChild(inFocus);
  } else {
    for (const op of perChild)
      results.push(await verifyOne(op, ctx, options, { position: focusPosition }));
  }
  const verified = options.allChildren ? targets.map((t) => t.position) : [focusPosition];
  return buildReport("ok", { total: guardian.children.length, verified }, results);
}

/**
 * The command's exit code, by EXIT_CODE_BY_KIND: drift anywhere is `upstream`
 * (7, as a drift error is everywhere); otherwise the first error's kind; 0
 * when everything is ok or skipped.
 */
export function verifyExitCode(report: VerifyReport): number {
  if (report.session !== "ok" || report.summary.drift > 0) return EXIT_CODE_BY_KIND.upstream;
  const error = report.results.find(
    (r): r is Extract<VerifyResult, { status: "error" }> => r.status === "error",
  );
  return error ? EXIT_CODE_BY_KIND[error.kind] : 0;
}
