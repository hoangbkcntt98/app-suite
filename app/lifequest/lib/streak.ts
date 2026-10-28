import { MissionLog } from "@prisma/client";
import { getTodayInTokyoDateOnly } from "@lifequest/lib/date";

function formatDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export function calculateCurrentStreakFromLogs(
  logs: Pick<MissionLog, "completedDate">[]
) {
  const completedDateSet = new Set(
    logs.map((log) => formatDateKey(log.completedDate))
  );

  let streak = 0;
  let cursorDate = getTodayInTokyoDateOnly();

  while (completedDateSet.has(formatDateKey(cursorDate))) {
    streak += 1;
    cursorDate = addDays(cursorDate, -1);
  }

  return streak;
}