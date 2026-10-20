import { prisma } from "@lifequest/lib/prisma";
import { getTodayInTokyoDateOnly } from "@lifequest/lib/date";

export async function getTodayMissionSummary(userId: string) {
  const today = getTodayInTokyoDateOnly();

  const missions = await prisma.mission.findMany({
    where: {
      userId,
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
      logs: {
        where: {
          completedDate: today,
        },
        select: {
          id: true,
        },
      },
    },
  });

  const completed = missions.filter((mission) => mission.logs.length > 0).length;

  return {
    total: missions.length,
    completed,
    remaining: Math.max(0, missions.length - completed),
  };
}
