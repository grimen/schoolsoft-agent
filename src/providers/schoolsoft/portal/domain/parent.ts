/**
 * `GET /eva/api/v1/parent`: the guardian and their children (field names
 * recorded live 2026-09-06). Mapped to the vendor-neutral GuardianParent;
 * fields core never uses (pictures, GUIDs, usernames) are dropped here, so
 * they never reach the saved session.
 */
import { z } from "zod";
import type { GuardianParent } from "../../../../core/portal/types.js";
import { parseUpstream } from "./parse.js";

const text = z
  .string()
  .nullish()
  .transform((v) => v ?? "");

const rawParent = z.object({
  userId: z.number().int(),
  firstName: z.string(),
  lastName: text,
  children: z.array(
    z.object({
      studentId: z.number().int(),
      firstName: z.string(),
      lastName: text,
      schools: z.array(z.object({ orgId: z.number().int(), name: z.string(), className: text })),
    }),
  ),
});

export function toGuardianParent(data: unknown): GuardianParent {
  const raw = parseUpstream(rawParent, data, "getParent");
  return {
    userId: raw.userId,
    firstName: raw.firstName,
    lastName: raw.lastName,
    children: raw.children.map((c) => ({
      studentId: c.studentId,
      firstName: c.firstName,
      lastName: c.lastName,
      schools: c.schools.map((s) => ({ orgId: s.orgId, name: s.name, className: s.className })),
    })),
  };
}
