import { NextResponse } from "next/server";
import { query } from "@lifequest/lib/db";
import { getCurrentUserFromCookie } from "@lifequest/lib/auth";
import {
  addDaysUTC,
  formatDateKey,
  getLastNDaysInTokyo,
} from "@lifequest/lib/date";
import { getSelectedCharacter, getUserCharacterCount } from "@lifequest/lib/character/session";
import { getRequiredExp } from "@lifequest/lib/level";

export async function GET() {
  try {
    const authUser = await getCurrentUserFromCookie();

    if (!authUser) {
      return NextResponse.json(
        {
          message: "Unauthorized.",
        },
        { status: 401 }
      );
    }

    const days = getLastNDaysInTokyo(7);
    const startDate = days[0];
    const endDateExclusive = addDaysUTC(days[days.length - 1], 1);

    const character = await getSelectedCharacter(authUser.userId);

    if (!character) {
      const characterCount = await getUserCharacterCount(authUser.userId);

      return NextResponse.json(
        {
          message:
            characterCount > 0
              ? "Please select a character."
              : "Character not found.",
          needCreateCharacter: characterCount === 0,
          needSelectCharacter: characterCount > 0,
        },
        { status: 404 }
      );
    }

    type LogRow = {
      completedDate: Date;
      expEarned: number;
      goldEarned: number;
      statEarned: number;
      mission: {
        id: string;
        title: string;
        difficulty: string;
        attributeId: string;
        attribute: { id: string; name: string; icon: string | null; color: string | null };
      };
    };
    const [logResult, missionResult, attributeResult] = await Promise.all([
      query<LogRow>(
        `SELECT l."completedDate", l."expEarned", l."goldEarned", l."statEarned",
          json_build_object(
            'id', m.id, 'title', m.title, 'difficulty', m.difficulty,
            'attributeId', m."attributeId",
            'attribute', json_build_object('id', a.id, 'name', a.name, 'icon', a.icon, 'color', a.color)
          ) AS mission
         FROM mission_logs l JOIN missions m ON m.id = l."missionId"
         JOIN attributes a ON a.id = m."attributeId"
         WHERE l."characterId" = $1 AND l."completedDate" >= $2 AND l."completedDate" < $3
         ORDER BY l."completedDate" ASC`,
        [character.id, startDate, endDateExclusive]
      ),
      query(`SELECT id FROM missions WHERE "characterId" = $1 AND "isActive" = TRUE`, [character.id]),
      query(`SELECT * FROM attributes WHERE "characterId" = $1 ORDER BY "createdAt" ASC`, [character.id]),
    ]);
    const logs = logResult.rows;
    const activeMissions = missionResult.rows;
    const attributes = attributeResult.rows;

    const logsByDate = new Map<string, typeof logs>();

    for (const log of logs) {
      const key = formatDateKey(log.completedDate);

      if (!logsByDate.has(key)) {
        logsByDate.set(key, []);
      }

      logsByDate.get(key)!.push(log);
    }

    const daily = days.map((date) => {
      const key = formatDateKey(date);
      const dayLogs = logsByDate.get(key) ?? [];

      const expEarned = dayLogs.reduce((sum, log) => sum + log.expEarned, 0);
      const goldEarned = dayLogs.reduce((sum, log) => sum + log.goldEarned, 0);
      const statEarned = dayLogs.reduce((sum, log) => sum + log.statEarned, 0);

      return {
        date: key,
        completedCount: dayLogs.length,
        expEarned,
        goldEarned,
        statEarned,
        missions: dayLogs.map((log) => ({
          id: log.mission.id,
          title: log.mission.title,
          difficulty: log.mission.difficulty,
          attribute: {
            id: log.mission.attribute.id,
            name: log.mission.attribute.name,
            icon: log.mission.attribute.icon,
            color: log.mission.attribute.color,
          },
          reward: {
            exp: log.expEarned,
            gold: log.goldEarned,
            stat: log.statEarned,
          },
        })),
      };
    });

    const totalCompleted = logs.length;
    const totalExp = logs.reduce((sum, log) => sum + log.expEarned, 0);
    const totalGold = logs.reduce((sum, log) => sum + log.goldEarned, 0);
    const totalStat = logs.reduce((sum, log) => sum + log.statEarned, 0);

    const completedDays = daily.filter((day) => day.completedCount > 0).length;

    const completionRate =
      activeMissions.length === 0
        ? 0
        : Math.round((totalCompleted / (activeMissions.length * 7)) * 100);

    const attributeSummary = attributes.map((attribute) => {
      const relatedLogs = logs.filter(
        (log) => log.mission.attributeId === attribute.id
      );

      return {
        id: attribute.id,
        name: attribute.name,
        icon: attribute.icon,
        color: attribute.color,
        completedCount: relatedLogs.length,
        expEarned: relatedLogs.reduce((sum, log) => sum + log.expEarned, 0),
        goldEarned: relatedLogs.reduce((sum, log) => sum + log.goldEarned, 0),
        statEarned: relatedLogs.reduce((sum, log) => sum + log.statEarned, 0),
      };
    });

    const bestDay = [...daily].sort(
      (a, b) => b.completedCount - a.completedCount
    )[0];

    return NextResponse.json({
      range: {
        startDate: formatDateKey(startDate),
        endDate: formatDateKey(days[days.length - 1]),
        days: 7,
      },
      character: {
        id: character.id,
        name: character.name,
        level: character.level,
        exp: character.exp,
        requiredExp: getRequiredExp(character.level),
        gold: character.gold,
        className: character.className,
      },
      summary: {
        totalCompleted,
        totalExp,
        totalGold,
        totalStat,
        completedDays,
        completionRate,
        activeMissionCount: activeMissions.length,
        bestDay,
      },
      attributeSummary,
      daily,
    });
  } catch (error) {
    console.error("WEEKLY_REPORT_ERROR", error);

    return NextResponse.json(
      {
        message: "Internal server error.",
      },
      { status: 500 }
    );
  }
}
