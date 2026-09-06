import { z } from "zod";
import { join } from "node:path";
import { defineOperation } from "./types.js";
import { SchoolDirectory } from "../api/schools.js";

export const findSchool = defineOperation({
  name: "find_school",
  title: "Find school",
  description: `Look up a school in SchoolSoft's public directory (~3400 schools) to get
the tenant slug and orgId needed for configuration. No login required.

Args:
  - query (string): school name or part of it, e.g. "Rösjöskolan" or "Täby".
  - limit (number, optional): max results, default 10.

Returns: { schools: [{ name, slug, orgId, score }] } best match first.

Use when: the user does not know their SchoolSoft slug, or before
configuring this integration for a new school.`,
  input: {
    query: z.string().min(2).describe("School name or part of it"),
    limit: z.number().int().min(1).max(50).optional().describe("Max results, default 10"),
  },
  annotations: { readOnly: true, destructive: false, idempotent: true, requiresAuth: false },
  async run(ctx, { query, limit }) {
    const dir = new SchoolDirectory({ cacheFile: join(ctx.config.configDir, "schools.json") });
    const schools = await dir.find(query, limit ?? 10);
    return { query, schools };
  },
});
