import { NextRequest, NextResponse } from "next/server";
import { CharacterClass } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@lifequest/lib/prisma";
import { getCurrentUserFromCookie } from "@lifequest/lib/auth";
import { DEFAULT_ATTRIBUTES } from "@lifequest/lib/default-attributes";
import { CHARACTER_COOKIE, getSelectedCharacter } from "@lifequest/lib/character/session";

const createCharacterSchema = z.object({
 name: z.string().min(1).max(30),
  className: z.nativeEnum(CharacterClass).default(CharacterClass.KIEM_TU),
 avatarUrl: z.string().url().optional().nullable(),
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

    const characters = await prisma.character.findMany({
      where: {
        userId: authUser.userId,
      },
      orderBy: {
        createdAt: "desc",
      },
    });
    const selectedCharacter = await getSelectedCharacter(authUser.userId);

    const attributes = await prisma.attribute.findMany({
      where: {
        characterId: selectedCharacter?.id ?? "",
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    return NextResponse.json({
      character: selectedCharacter,
      selectedCharacter,
      characters,
      attributes,
    });
  } catch (error) {
    console.error("GET_CHARACTER_ERROR", error);

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

    const parsed = createCharacterSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          message: "Invalid character data.",
          errors: parsed.error.flatten(),
        },
        { status: 400 }
      );
    }

    const { name, className, avatarUrl } = parsed.data;

    const result = await prisma.$transaction(async (tx) => {
      const character = await tx.character.create({
        data: {
          userId: authUser.userId,
          name,
          className,
          avatarUrl,
        },
      });

      const attributes = await tx.attribute.createManyAndReturn({
        data: DEFAULT_ATTRIBUTES.map((attribute) => ({
          userId: authUser.userId,
          characterId: character.id,
          name: attribute.name,
          icon: attribute.icon,
          color: attribute.color,
          multiplier: attribute.multiplier,
        })),
      });

      return {
        character,
        attributes,
      };
    });

    const response = NextResponse.json(
      {
        message: "Character created successfully.",
        character: result.character,
        attributes: result.attributes,
      },
      { status: 201 }
    );
    response.cookies.set(CHARACTER_COOKIE, result.character.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.LIFEQUEST_COOKIE_SECURE === "true",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });

    return response;
  } catch (error) {
    console.error("CREATE_CHARACTER_ERROR", error);

    return NextResponse.json(
      {
        message: "Internal server error.",
      },
      { status: 500 }
    );
  }
}
