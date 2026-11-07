import { query } from "@lifequest/lib/db";
import { getTodayInTokyoDateOnly } from "@lifequest/lib/date";

export async function getTodayMissionSummary(userId: string) {
  const today = getTodayInTokyoDateOnly();

  const result = await query<{ total: string; completed: string }>(
    `SELECT COUNT(*)::text AS total,
            COUNT(*) FILTER (WHERE ml.id IS NOT NULL)::text AS completed
     FROM missions m
     LEFT JOIN mission_logs ml
       ON ml."missionId" = m.id AND ml."completedDate" = $2
     WHERE m."userId" = $1 AND m."isActive" = TRUE
       AND (m."startDate" IS NULL OR m."startDate" <= $2)
       AND (m."endDate" IS NULL OR m."endDate" >= $2)`,
    [userId, today]
  );
  const total = Number(result.rows[0]?.total ?? 0);
  const completed = Number(result.rows[0]?.completed ?? 0);

  return {
    total,
    completed,
    remaining: Math.max(0, total - completed),
  };
}
