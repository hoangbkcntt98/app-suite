import { NextRequest, NextResponse } from "next/server";
import { query } from "@lifequest/lib/db";
import { getCurrentUserFromCookie } from "@lifequest/lib/auth";
import { formatDateKey } from "@lifequest/lib/date";
import { getSelectedCharacter } from "@lifequest/lib/character/session";

function getCurrentTokyoYearMonth() {
  const now = new Date();

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);

  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);

  return {
    year,
    month,
  };
}

function getMonthRangeUTC(year: number, month: number) {
  const startDate = new Date(Date.UTC(year, month - 1, 1));
  const endDateExclusive = new Date(Date.UTC(year, month, 1));

  return {
    startDate,
    endDateExclusive,
  };
}

function getDaysInMonthUTC(year: number, month: number) {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();

  return Array.from({ length: lastDay }).map((_, index) => {
    return new Date(Date.UTC(year, month - 1, index + 1));
  });
}

export async function GET(request: NextRequest) {
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

    const searchParams = request.nextUrl.searchParams;

    const currentTokyo = getCurrentTokyoYearMonth();

    const year = Number(searchParams.get("year") ?? currentTokyo.year);
    const month = Number(searchParams.get("month") ?? currentTokyo.month);

    if (!year || !month || month < 1 || month > 12) {
      return NextResponse.json(
        {
          message: "Invalid year or month.",
        },
        { status: 400 }
      );
    }

    const { startDate, endDateExclusive } = getMonthRangeUTC(year, month);
    const days = getDaysInMonthUTC(year, month);
    const character = await getSelectedCharacter(authUser.userId);

    if (!character) {
      return NextResponse.json(
        { message: "Selected character not found." },
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
    const [logResult, missionResult, eventResult] = await Promise.all([
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
      query(
        `SELECT id FROM missions WHERE "characterId" = $1 AND "isActive" = TRUE`,
        [character.id]
      ),
      query(
        `SELECT * FROM calendar_events
         WHERE "userId" = $1 AND "startDate" >= $2 AND "startDate" < $3
         ORDER BY "startDate" ASC, "createdAt" ASC`,
        [authUser.userId, startDate, endDateExclusive]
      ),
    ]);
    const logs = logResult.rows;
    const activeMissions = missionResult.rows;
    const events = eventResult.rows;

    const logsByDate = new Map<string, typeof logs>();

    for (const log of logs) {
      const key = formatDateKey(log.completedDate);

      if (!logsByDate.has(key)) {
        logsByDate.set(key, []);
      }

      logsByDate.get(key)!.push(log);
    }

    const eventsByDate = new Map<string, typeof events>();

    for (const event of events) {
      const key = formatDateKey(event.startDate);

      if (!eventsByDate.has(key)) {
        eventsByDate.set(key, []);
      }

      eventsByDate.get(key)!.push(event);
    }

    const calendar = days.map((date) => {
      const key = formatDateKey(date);
      const dayLogs = logsByDate.get(key) ?? [];
      const dayEvents = eventsByDate.get(key) ?? [];

      const completedCount = dayLogs.length;
      const expEarned = dayLogs.reduce((sum, log) => sum + log.expEarned, 0);
      const goldEarned = dayLogs.reduce((sum, log) => sum + log.goldEarned, 0);
      const statEarned = dayLogs.reduce((sum, log) => sum + log.statEarned, 0);

      let intensity = 0;

      if (completedCount >= 1) intensity = 1;
      if (completedCount >= 3) intensity = 2;
      if (completedCount >= 5) intensity = 3;
      if (completedCount >= 8) intensity = 4;

      return {
        date: key,
        day: date.getUTCDate(),
        weekday: date.getUTCDay(),
        completedCount,
        expEarned,
        goldEarned,
        statEarned,
        intensity,
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
        events: dayEvents.map((event) => ({
          id: event.id,
          title: event.title,
          location: event.location,
          content: event.content,
          startDate: event.startDate,
          endDate: event.endDate,
        })),
      };
    });

    const totalCompleted = logs.length;
    const totalExp = logs.reduce((sum, log) => sum + log.expEarned, 0);
    const totalGold = logs.reduce((sum, log) => sum + log.goldEarned, 0);
    const totalStat = logs.reduce((sum, log) => sum + log.statEarned, 0);
    const activeDays = calendar.filter((day) => day.completedCount > 0).length;

    return NextResponse.json({
      year,
      month,
      summary: {
        totalCompleted,
        totalExp,
        totalGold,
        totalStat,
        activeDays,
        totalDays: calendar.length,
        activeMissionCount: activeMissions.length,
        eventCount: events.length,
      },
      calendar,
    });
  } catch (error) {
    console.error("CALENDAR_ERROR", error);

    return NextResponse.json(
      {
        message: "Internal server error.",
      },
      { status: 500 }
    );
  }
}
