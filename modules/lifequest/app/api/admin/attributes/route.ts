import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@lifequest/lib/prisma";
import { requireAdmin } from "@lifequest/lib/admin/auth";

const createAttributeSchema = z.object({
  userId: z.string().min(1),
  name: z.string().min(1).max(30),
  value: z.number().int().min(0).default(0),
  icon: z.string().max(10).optional().nullable(),
  color: z.string().max(30).optional().nullable(),
});

export async function GET() {
  const { response } = await requireAdmin();
  if (response) return response;

  const attributes = await prisma.attribute.findMany({
    orderBy: {
      createdAt: "desc",
    },
    include: {
      user: {
        select: {
          id: true,
          email: true,
        },
      },
      character: {
        select: {
          id: true,
          name: true,
        },
      },
      _count: {
        select: {
          missions: true,
        },
      },
    },
  });

  return NextResponse.json({ attributes });
}

export async function POST(request: NextRequest) {
  const { response } = await requireAdmin();
  if (response) return response;

  const body = await request.json().catch(() => null);
  const parsed = createAttributeSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid attribute data." },
      { status: 400 }
    );
  }

  try {
    const character = await prisma.character.findFirst({
      where: {
        userId: parsed.data.userId,
      },
      orderBy: {
        createdAt: "asc",
      },
      select: {
        id: true,
      },
    });

    if (!character) {
      return NextResponse.json(
        { message: "Create a character before adding attributes." },
        { status: 400 }
      );
    }

    const attribute = await prisma.attribute.create({
      data: {
        ...parsed.data,
        characterId: character.id,
      },
    });

    return NextResponse.json({ attribute }, { status: 201 });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      return NextResponse.json(
        { message: "Attribute name already exists for this character." },
        { status: 409 }
      );
    }

    throw error;
  }
}
