import { NextRequest, NextResponse } from "next/server";
import { MissionDifficulty, MissionRepeatType } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@lifequest/lib/prisma";
import { getCurrentUserFromCookie } from "@lifequest/lib/auth";
import { getMissionRewardByDifficulty } from "@lifequest/lib/mission-rewards";
import { getSelectedCharacter } from "@lifequest/lib/character/session";

const createMissionSchema = z.object({
  attributeId: z.string().min(1),
  title: z.string().min(1).max(100),
  description: z.string().max(500).optional().nullable(),
  difficulty: z.nativeEnum(MissionDifficulty).default(MissionDifficulty.NORMAL),
  repeatType: z.nativeEnum(MissionRepeatType).default(MissionRepeatType.DAILY),
  startDate: z.string().datetime().optional().nullable(),
  endDate: z.string().datetime().optional().nullable(),
  goldReward: z.coerce.number().int().min(0).optional().nullable(),
});

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

    const character = await getSelectedCharacter(authUser.userId);

    if (!character) {
      return NextResponse.json(
        { message: "Selected character not found." },
        { status: 404 }
      );
    }

    const missions = await prisma.mission.findMany({
      where: {
        characterId: character.id,
      },
      include: {
        attribute: true,
        logs: {
          orderBy: {
            completedDate: "desc",
          },
          take: 10,
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return NextResponse.json({
      missions,
    });
  } catch (error) {
    console.error("GET_MISSIONS_ERROR", error);

    return NextResponse.json(
      {
        message: "Internal server error.",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
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

    const body = await request.json();

    const parsed = createMissionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          message: "Invalid mission data.",
          errors: parsed.error.flatten(),
        },
        { status: 400 }
      );
    }

    const {
      attributeId,
      title,
      description,
      difficulty,
      repeatType,
      startDate,
      endDate,
      goldReward,
    } = parsed.data;

    const character = await getSelectedCharacter(authUser.userId);

    if (!character) {
      return NextResponse.json(
        { message: "Selected character not found." },
        { status: 404 }
      );
    }

    const attribute = await prisma.attribute.findFirst({
      where: {
        id: attributeId,
        characterId: character.id,
      },
    });

    if (!attribute) {
      return NextResponse.json(
        {
          message: "Attribute not found.",
        },
        { status: 404 }
      );
    }

    const reward = getMissionRewardByDifficulty(difficulty);
    const parsedStartDate = startDate ? new Date(startDate) : null;
    const parsedEndDate = endDate ? new Date(endDate) : null;

    if (parsedStartDate && parsedEndDate && parsedEndDate < parsedStartDate) {
      return NextResponse.json(
        {
          message: "Due date must be after start date.",
        },
        { status: 400 }
      );
    }

    const mission = await prisma.mission.create({
      data: {
        userId: authUser.userId,
        characterId: character.id,
        attributeId,
        title,
        description,
        difficulty,
        repeatType,
        startDate: parsedStartDate,
        endDate: parsedEndDate,
        expReward: reward.expReward,
        goldReward: goldReward ?? reward.goldReward,
        statReward: reward.statReward,
      },
      include: {
        attribute: true,
      },
    });

    return NextResponse.json(
      {
        message: "Mission created successfully.",
        mission,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("CREATE_MISSION_ERROR", error);

    return NextResponse.json(
      {
        message: "Internal server error.",
      },
      { status: 500 }
    );
  }
}
