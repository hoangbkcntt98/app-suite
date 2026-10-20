import { NextResponse } from "next/server";
import { prisma } from "@lifequest/lib/prisma";
import { getCurrentUserFromCookie } from "@lifequest/lib/auth";
import { getSelectedCharacter } from "@lifequest/lib/character/session";

export async function GET() {
  try {
    const authUser = await getCurrentUserFromCookie();

    if (!authUser) {
      return NextResponse.json(
        {
          user: null,
        },
        { status: 401 }
      );
    }

    const [user, selectedCharacter] = await Promise.all([
      prisma.user.findUnique({
      where: {
        id: authUser.userId,
      },
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
        characters: {
          select: {
            id: true,
            name: true,
            className: true,
            level: true,
            exp: true,
            gold: true,
          },
        },
      },
    }),
      getSelectedCharacter(authUser.userId),
    ]);

    if (!user) {
      return NextResponse.json(
        {
          user: null,
        },
        { status: 401 }
      );
    }

    return NextResponse.json({
      user: {
        ...user,
        character: selectedCharacter,
      },
    });
  } catch (error) {
    console.error("ME_ERROR", error);

    return NextResponse.json(
      {
        message: "Internal server error.",
      },
      { status: 500 }
    );
  }
}
