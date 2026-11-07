import { NextResponse } from "next/server";
import { query } from "@lifequest/lib/db";
import { getCurrentUserFromCookie } from "@lifequest/lib/auth";
import { getTodayInTokyoDateOnly } from "@lifequest/lib/date";
import { calculateCurrentStreakFromLogs } from "@lifequest/lib/streak";
import { getDailyQuoteIndex } from "@lifequest/lib/quote";
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

    const today = getTodayInTokyoDateOnly();

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

    const [attributeResult, missionResult, eventResult] = await Promise.all([
      query(`SELECT * FROM attributes WHERE "characterId" = $1 ORDER BY "createdAt" ASC`, [character.id]),
      query(
        `SELECT m.*, to_jsonb(a) AS attribute,
          EXISTS (SELECT 1 FROM mission_logs l WHERE l."missionId" = m.id AND l."completedDate" = $2) AS completed
         FROM missions m JOIN attributes a ON a.id = m."attributeId"
         WHERE m."characterId" = $1 AND m."isActive" = TRUE
           AND (m."startDate" IS NULL OR m."startDate" <= $2)
           AND (m."endDate" IS NULL OR m."endDate" >= $2)
         ORDER BY m."createdAt" DESC`,
        [character.id, today]
      ),
      query(
        `SELECT * FROM calendar_events WHERE "userId" = $1 AND "startDate" = $2
         ORDER BY "startDate" ASC, "createdAt" ASC`,
        [authUser.userId, today]
      ),
    ]);
    const attributes = attributeResult.rows;
    const missions = missionResult.rows;
    const todayEvents = eventResult.rows;

    const todayMissions = missions.map((mission) => {
      const completed = mission.completed;

      return {
        id: mission.id,
        title: mission.title,
        description: mission.description,
        difficulty: mission.difficulty,
        repeatType: mission.repeatType,
        expReward: mission.expReward,
        goldReward: mission.goldReward,
        statReward: mission.statReward,
        startDate: mission.startDate,
        endDate: mission.endDate,
        isActive: mission.isActive,
        completed,
        attribute: {
          id: mission.attribute.id,
          name: mission.attribute.name,
          icon: mission.attribute.icon,
          color: mission.attribute.color,
        },
      };
    });

    const recentLogs = await query<{ completedDate: Date }>(
      `SELECT "completedDate" FROM mission_logs
       WHERE "characterId" = $1 ORDER BY "completedDate" DESC LIMIT 365`,
      [character.id]
    ).then((result) => result.rows);

    const streak = calculateCurrentStreakFromLogs(recentLogs);

    const quoteCountResult = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM daily_quotes`
    );
    const quoteCount = Number(quoteCountResult.rows[0]?.count ?? 0);

    let quote = null;

    if (quoteCount > 0) {
      const quoteIndex = getDailyQuoteIndex(today, quoteCount);

      quote = await query(
        `SELECT * FROM daily_quotes ORDER BY "createdAt" ASC OFFSET $1 LIMIT 1`,
        [quoteIndex]
      ).then((result) => result.rows[0] ?? null);
    }

    const requiredExp = getRequiredExp(character.level);

    return NextResponse.json({
      character: {
        id: character.id,
        name: character.name,
        className: character.className,
        level: character.level,
        exp: character.exp,
        requiredExp,
        gold: character.gold,
        avatarUrl: character.avatarUrl,
      },
      attributes,
      todayMissions,
      todayEvents: todayEvents.map((event) => ({
        id: event.id,
        title: event.title,
        location: event.location,
        startDate: event.startDate,
        endDate: event.endDate,
      })),
      streak,
      quote,
      summary: {
        totalMissionsToday: todayMissions.length,
        completedMissionsToday: todayMissions.filter((mission) => mission.completed)
          .length,
        totalEventsToday: todayEvents.length,
        completionRate:
          todayMissions.length === 0
            ? 0
            : Math.round(
                (todayMissions.filter((mission) => mission.completed).length /
                  todayMissions.length) *
                  100
              ),
      },
    });
  } catch (error) {
    console.error("DASHBOARD_ERROR", error);

    return NextResponse.json(
      {
        message: "Internal server error.",
      },
      { status: 500 }
    );
  }
}
