/**
 * `GET /eva/api/v1/schools/<orgId>/lunchmenu/<week>` (Bearer): one week's
 * menu, `dayId` Monday = 1 … Friday = 5 (recorded live 2026-09-06). The answer
 * carries no year, so the caller's ISO week-year dates each day.
 */
import { z } from "zod";
import type { LunchDay } from "../../../../core/domain/schemas.js";
import { isoWeekDate } from "../../../../core/domain/time.js";
import { parseUpstream } from "./parse.js";

const rawLunch = z.array(
  z.object({
    week: z.number().int().min(1).max(53),
    dayId: z.number().int().min(1).max(7),
    dishes: z.array(
      z.object({
        mealType: z
          .union([z.string(), z.number()])
          .nullish()
          .transform((v) => (v === null || v === undefined || v === "" ? null : String(v))),
        description: z.string(),
      }),
    ),
  }),
);

export function toLunchDays(data: unknown, year: number, week: number): LunchDay[] {
  return parseUpstream(rawLunch, data, "getLunchWeek").map((day) => ({
    date: isoWeekDate(year, week, day.dayId),
    weekday: day.dayId,
    dishes: day.dishes.map((d) => ({ kind: d.mealType, description: d.description })),
  }));
}
