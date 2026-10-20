import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@lifequest/lib/prisma";
import { getCurrentUserFromCookie } from "@lifequest/lib/auth";
import { getSelectedCharacter } from "@lifequest/lib/character/session";

const createAttributeSchema = z.object({
  name: z.string().min(1).max(30),
  value: z.coerce.number().int().min(0).optional(),
  icon: z.string().max(10).optional().nullable(),
  color: z.string().max(30).optional().nullable(),
});

function getErrorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? error.code
    : null;
}

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

    const attributes = await prisma.attribute.findMany({
      where: {
        characterId: character.id,
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    return NextResponse.json({
      attributes,
    });
  } catch (error) {
    console.error("GET_ATTRIBUTES_ERROR", error);

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

    const parsed = createAttributeSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          message: "Invalid attribute data.",
          errors: parsed.error.flatten(),
        },
        { status: 400 }
      );
    }

    const { name, value, icon, color } = parsed.data;

    const character = await getSelectedCharacter(authUser.userId);

    if (!character) {
      return NextResponse.json(
        { message: "Selected character not found." },
        { status: 404 }
      );
    }

    const attribute = await prisma.attribute.create({
      data: {
        userId: authUser.userId,
        characterId: character.id,
        name,
        value: value ?? 0,
        icon,
        color,
      },
    });

    return NextResponse.json(
      {
        message: "Attribute created successfully.",
        attribute,
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    console.error("CREATE_ATTRIBUTE_ERROR", error);

    if (getErrorCode(error) === "P2002") {
      return NextResponse.json(
        {
          message: "Attribute name already exists.",
        },
        { status: 409 }
      );
    }

    return NextResponse.json(
      {
        message: "Internal server error.",
      },
      { status: 500 }
    );
  }
}
