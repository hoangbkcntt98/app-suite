import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUserFromCookie } from "@lifequest/lib/auth";
import { getSelectedCharacter } from "@lifequest/lib/character/session";
import { prisma } from "@lifequest/lib/prisma";

const focusRewardSchema = z.object({
  minutes: z.coerce.number().int().min(1).max(200),
});

export async function POST(request: NextRequest) {
  try {
    const authUser = await getCurrentUserFromCookie();

    if (!authUser) {
      return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const parsed = focusRewardSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { message: "Invalid focus reward data." },
        { status: 400 }
      );
    }

    const character = await getSelectedCharacter(authUser.userId);

    if (!character) {
      return NextResponse.json(
        { message: "Selected character not found." },
        { status: 404 }
      );
    }

    const updatedCharacter = await prisma.character.update({
      where: {
        id: character.id,
      },
      data: {
        gold: {
          increment: parsed.data.minutes,
        },
      },
    });

    return NextResponse.json({
      reward: {
        gold: parsed.data.minutes,
      },
      character: {
        id: updatedCharacter.id,
        gold: updatedCharacter.gold,
      },
    });
  } catch (error) {
    console.error("FOCUS_REWARD_ERROR", error);

    return NextResponse.json(
      { message: "Internal server error." },
      { status: 500 }
    );
  }
}
