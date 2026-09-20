/**
 * The one way a surface runs an operation. `fresh: true` (declared by every
 * operation that can be answered from the read cache) selects the portal
 * that bypasses the cache, so the operation itself stays unaware of caching.
 */
import type { z } from "zod";
import type { Capability } from "../portal/types.js";
import type { Operation, OperationContext } from "./types.js";

export function runOperation<I extends z.ZodRawShape, O, C extends Capability>(
  op: Operation<I, O, C>,
  ctx: OperationContext<C>,
  args: z.infer<z.ZodObject<I>>,
): Promise<O> {
  const fresh = (args as { fresh?: unknown }).fresh === true && ctx.freshPortal !== undefined;
  return op.run(fresh ? { ...ctx, portal: ctx.freshPortal! } : ctx, args);
}
