import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@lifequest/lib/prisma";
import { requireAdmin } from "@lifequest/lib/admin/auth";

const updateAttributeSchema = z.object({
  name: z.string().min(1).max(30).optional(),
  value: z.number().int().min(0).optional(),
  icon: z.string().max(10).optional().nullable(),
  color: z.string().max(30).optional().nullable(),
});

export async function PATCH(
  request: NextRequest,
  context: RouteContext<"/lifequest/api/admin/attributes/[id]">
) {
  const { response } = await requireAdmin();
  if (response) return response;

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const parsed = updateAttributeSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid attribute data." },
      { status: 400 }
    );
  }

  try {
    const attribute = await prisma.attribute.update({
      where: { id },
      data: parsed.data,
    });

    return NextResponse.json({ attribute });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      return NextResponse.json(
        { message: "Attribute name already exists for this character." },
        { status: 409 }
      );
    }

    if ((error as { code?: string }).code === "P2025") {
      return NextResponse.json(
        { message: "Attribute not found." },
        { status: 404 }
      );
    }

    throw error;
  }
}

export async function DELETE(
  _request: NextRequest,
  context: RouteContext<"/lifequest/api/admin/attributes/[id]">
) {
  const { response } = await requireAdmin();
  if (response) return response;

  const { id } = await context.params;
  const attribute = await prisma.attribute.findUnique({
    where: { id },
    include: {
      missions: true,
    },
  });

  if (!attribute) {
    return NextResponse.json({ message: "Attribute not found." }, { status: 404 });
  }

  if (attribute.missions.length > 0) {
    return NextResponse.json(
      { message: "Cannot delete attribute because it has missions." },
      { status: 400 }
    );
  }

  await prisma.attribute.delete({
    where: { id },
  });

  return NextResponse.json({ message: "Attribute deleted." });
}
