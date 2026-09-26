/**
 * The one way a surface runs an operation. `fresh: true` (declared by every
 * operation that can be answered from the read cache) selects the portal
 * that bypasses the cache, so the operation itself stays unaware of caching.
 *
 * An operation that declares `output` has its result validated here, after
 * the cache and for every surface, and the parsed value is returned. A
 * result that does not fit, or a provider that could not map the portal's
 * answer, becomes one ResponseDriftError naming the operation: bad data is
 * never passed on.
 */
import type { z } from "zod";
import type { Capability } from "../portal/types.js";
import type { Operation, OperationContext } from "./types.js";
import { ResponseDriftError, describeIssues } from "../errors/index.js";

export async function runOperation<I extends z.ZodRawShape, O, C extends Capability>(
  op: Operation<I, O, C>,
  ctx: OperationContext<C>,
  args: z.infer<z.ZodObject<I>>,
): Promise<O> {
  const fresh = (args as { fresh?: unknown }).fresh === true && ctx.freshPortal !== undefined;
  let result: O;
  try {
    result = await op.run(fresh ? { ...ctx, portal: ctx.freshPortal! } : ctx, args);
  } catch (e) {
    throw e instanceof ResponseDriftError ? e.forOperation(op.name) : e;
  }
  if (!op.output) return result;
  const parsed = op.output.safeParse(result);
  if (!parsed.success)
    throw new ResponseDriftError(op.name, describeIssues(parsed.error.issues), op.name);
  return parsed.data;
}
