import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@lifequest/lib/prisma";
import { getCurrentUserFromCookie } from "@lifequest/lib/auth";
import { getTodayInTokyoDateOnly } from "@lifequest/lib/date";
import { calculateLevelUp } from "@lifequest/lib/level";
import { getSelectedCharacter } from "@lifequest/lib/character/session";
import { calculateExpWithMultiplier } from "@lifequest/lib/mission-rewards";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(_request: NextRequest, context: RouteContext) {
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

    const { id } = await context.params;
    const today = getTodayInTokyoDateOnly();
    const character = await getSelectedCharacter(authUser.userId);

    if (!character) {
      return NextResponse.json(
        { message: "Selected character not found." },
        { status: 404 }
      );
    }

    const mission = await prisma.mission.findFirst({
      where: {
        id,
        characterId: character.id,
        isActive: true,
      },
      include: {
        attribute: true,
      },
    });

    if (!mission) {
      return NextResponse.json(
        {
          message: "Mission not found or inactive.",
        },
        { status: 404 }
      );
    }

    const existingLog = await prisma.missionLog.findUnique({
      where: {
        missionId_completedDate: {
          missionId: mission.id,
          completedDate: today,
        },
      },
    });

    if (existingLog) {
      return NextResponse.json(
        {
          message: "Mission already completed today.",
        },
        { status: 409 }
      );
    }

    const result = await prisma.$transaction(async (tx) => {
     const updatedAttribute = await tx.attribute.update({
       where: {
         id: mission.attributeId,
       },
       data: {
         value: {
           increment: mission.statReward,
         },
       },
     });

      const expWithMultiplier = calculateExpWithMultiplier(
        updatedAttribute.value,
        updatedAttribute.multiplier
      );

      const missionLog = await tx.missionLog.create({
        data: {
          missionId: mission.id,
          userId: authUser.userId,
          characterId: character.id,
          completedDate: today,
          expEarned: expWithMultiplier,
          goldEarned: mission.goldReward,
          statEarned: mission.statReward,
        },
      });

      const rawExp = character.exp + expWithMultiplier;
      const rawGold = character.gold + mission.goldReward;

      const levelResult = calculateLevelUp(character.level, rawExp);

      const updatedCharacter = await tx.character.update({
        where: {
          id: character.id,
        },
        data: {
          exp: levelResult.exp,
          level: levelResult.level,
          gold: rawGold,
        },
      });

    return {
      missionLog,
      updatedAttribute,
      updatedCharacter,
      reward: {
        exp: expWithMultiplier,
        gold: mission.goldReward,
        stat: mission.statReward,
        attributeName: mission.attribute.name,
      },
        level: {
          before: character.level,
          after: updatedCharacter.level,
          didLevelUp: levelResult.didLevelUp,
          levelUpCount: levelResult.levelUpCount,
        },
      };
    });

    return NextResponse.json({
      message: result.level.didLevelUp
        ? "Mission completed! Level up!"
        : "Mission completed!",
      mission: {
        id: mission.id,
        title: mission.title,
      },
      reward: result.reward,
      character: {
        id: result.updatedCharacter.id,
        name: result.updatedCharacter.name,
        level: result.updatedCharacter.level,
        exp: result.updatedCharacter.exp,
        gold: result.updatedCharacter.gold,
      },
      attribute: {
        id: result.updatedAttribute.id,
        name: result.updatedAttribute.name,
        value: result.updatedAttribute.value,
      },
      level: result.level,
      log: result.missionLog,
    });
  } catch (error) {
    console.error("COMPLETE_MISSION_ERROR", error);

    return NextResponse.json(
      {
        message: "Internal server error.",
      },
      { status: 500 }
    );
  }
}
