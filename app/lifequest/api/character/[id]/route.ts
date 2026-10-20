import { NextResponse } from "next/server";
import { prisma } from "@lifequest/lib/prisma";
import { getCurrentUserFromCookie } from "@lifequest/lib/auth";
import {
  CHARACTER_COOKIE,
  getSelectedCharacter,
} from "@lifequest/lib/character/session";

export async function DELETE(
  _request: Request,
  context: RouteContext<"/lifequest/api/character/[id]">
) {
  try {
    const authUser = await getCurrentUserFromCookie();

    if (!authUser) {
      return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    }

    const { id } = await context.params;
    const selectedCharacter = await getSelectedCharacter(authUser.userId);

    const character = await prisma.character.findFirst({
      where: {
        id,
        userId: authUser.userId,
      },
      select: {
        id: true,
        name: true,
      },
    });

    if (!character) {
      return NextResponse.json({ message: "Character not found." }, { status: 404 });
    }

    await prisma.character.delete({
      where: {
        id: character.id,
      },
    });

    const shouldChooseNext =
      !selectedCharacter || selectedCharacter.id === character.id;
    const nextCharacter = shouldChooseNext
      ? await prisma.character.findFirst({
          where: {
            userId: authUser.userId,
          },
          orderBy: {
            createdAt: "desc",
          },
        })
      : selectedCharacter;

    const response = NextResponse.json({
      message: "Character deleted.",
      selectedCharacter: nextCharacter,
    });

    if (nextCharacter) {
      response.cookies.set(CHARACTER_COOKIE, nextCharacter.id, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.LIFEQUEST_COOKIE_SECURE === "true",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      });
    } else {
      response.cookies.set(CHARACTER_COOKIE, "", {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.LIFEQUEST_COOKIE_SECURE === "true",
        path: "/",
        maxAge: 0,
      });
    }

    return response;
  } catch (error) {
    console.error("DELETE_CHARACTER_ERROR", error);

    return NextResponse.json(
      { message: "Internal server error." },
      { status: 500 }
    );
  }
}
