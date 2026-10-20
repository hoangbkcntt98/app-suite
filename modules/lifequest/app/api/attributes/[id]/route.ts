import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@lifequest/lib/prisma";
import { getCurrentUserFromCookie } from "@lifequest/lib/auth";
import { getSelectedCharacter } from "@lifequest/lib/character/session";

const updateAttributeSchema = z.object({
  name: z.string().min(1).max(30).optional(),
  value: z.coerce.number().int().min(0).optional(),
  icon: z.string().max(10).optional().nullable(),
  color: z.string().max(30).optional().nullable(),
});

function getErrorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? error.code
    : null;
}

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
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
    const body = await request.json();

    const parsed = updateAttributeSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          message: "Invalid attribute data.",
          errors: parsed.error.flatten(),
        },
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

    const existingAttribute = await prisma.attribute.findFirst({
      where: {
        id,
        characterId: character.id,
      },
    });

    if (!existingAttribute) {
      return NextResponse.json(
        {
          message: "Attribute not found.",
        },
        { status: 404 }
      );
    }

    const attribute = await prisma.attribute.update({
      where: {
        id,
      },
      data: parsed.data,
    });

    return NextResponse.json({
      message: "Attribute updated successfully.",
      attribute,
    });
  } catch (error: unknown) {
    console.error("UPDATE_ATTRIBUTE_ERROR", error);

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

export async function DELETE(_request: NextRequest, context: RouteContext) {
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

    const character = await getSelectedCharacter(authUser.userId);

    if (!character) {
      return NextResponse.json(
        { message: "Selected character not found." },
        { status: 404 }
      );
    }

    const existingAttribute = await prisma.attribute.findFirst({
      where: {
        id,
        characterId: character.id,
      },
      include: {
        missions: true,
      },
    });

    if (!existingAttribute) {
      return NextResponse.json(
        {
          message: "Attribute not found.",
        },
        { status: 404 }
      );
    }

    if (existingAttribute.missions.length > 0) {
      return NextResponse.json(
        {
          message: "Cannot delete attribute because it has missions.",
        },
        { status: 400 }
      );
    }

    await prisma.attribute.delete({
      where: {
        id,
      },
    });

    return NextResponse.json({
      message: "Attribute deleted successfully.",
    });
  } catch (error) {
    console.error("DELETE_ATTRIBUTE_ERROR", error);

    return NextResponse.json(
      {
        message: "Internal server error.",
      },
      { status: 500 }
    );
  }
}
