import { NextResponse } from "next/server";
import { prisma } from "@lifequest/lib/prisma";
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

    const [attributes, missions, todayEvents] = await Promise.all([
      prisma.attribute.findMany({
        where: {
          characterId: character.id,
        },
        orderBy: {
          createdAt: "asc",
        },
      }),

      prisma.mission.findMany({
        where: {
          characterId: character.id,
          isActive: true,
          OR: [
            {
              startDate: null,
            },
            {
              startDate: {
                lte: today,
              },
            },
          ],
          AND: [
            {
              OR: [
                {
                  endDate: null,
                },
                {
                  endDate: {
                    gte: today,
                  },
                },
              ],
            },
          ],
        },
        include: {
          attribute: true,
          logs: {
            where: {
              completedDate: today,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      }),

      prisma.calendarEvent.findMany({
        where: {
          userId: authUser.userId,
          startDate: today,
        },
        orderBy: [{ startDate: "asc" }, { createdAt: "asc" }],
      }),
    ]);

    const todayMissions = missions.map((mission) => {
      const completed = mission.logs.length > 0;

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

    const recentLogs = await prisma.missionLog.findMany({
      where: {
        characterId: character.id,
      },
      select: {
        completedDate: true,
      },
      orderBy: {
        completedDate: "desc",
      },
      take: 365,
    });

    const streak = calculateCurrentStreakFromLogs(recentLogs);

    const quoteCount = await prisma.dailyQuote.count();

    let quote = null;

    if (quoteCount > 0) {
      const quoteIndex = getDailyQuoteIndex(today, quoteCount);

      const quotes = await prisma.dailyQuote.findMany({
        orderBy: {
          createdAt: "asc",
        },
        skip: quoteIndex,
        take: 1,
      });

      quote = quotes[0] ?? null;
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
