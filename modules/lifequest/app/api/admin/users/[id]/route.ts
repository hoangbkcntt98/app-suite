import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@lifequest/lib/prisma";
import { requireAdmin } from "@lifequest/lib/admin/auth";

const updateUserSchema = z.object({
  email: z.string().email().optional(),
  password: z.string().min(6).optional(),
  role: z.enum(["USER", "ADMIN"]).optional(),
});

export async function PATCH(
  request: NextRequest,
  context: RouteContext<"/lifequest/api/admin/users/[id]">
) {
  const { response } = await requireAdmin();
  if (response) return response;

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const parsed = updateUserSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid user data." }, { status: 400 });
  }

  const data: {
    email?: string;
    passwordHash?: string;
    role?: "USER" | "ADMIN";
  } = {};

  if (parsed.data.email) data.email = parsed.data.email;
  if (parsed.data.role) data.role = parsed.data.role;
  if (parsed.data.password) {
    data.passwordHash = await bcrypt.hash(parsed.data.password, 10);
  }

  try {
    const user = await prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ user });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      return NextResponse.json({ message: "Email already exists." }, { status: 409 });
    }

    if ((error as { code?: string }).code === "P2025") {
      return NextResponse.json({ message: "User not found." }, { status: 404 });
    }

    throw error;
  }
}

export async function DELETE(
  _request: NextRequest,
  context: RouteContext<"/lifequest/api/admin/users/[id]">
) {
  const { user: adminUser, response } = await requireAdmin();
  if (response) return response;

  const { id } = await context.params;

  if (adminUser?.id === id) {
    return NextResponse.json(
      { message: "You cannot delete your own admin account." },
      { status: 400 }
    );
  }

  await prisma.user.delete({
    where: { id },
  });

  return NextResponse.json({ message: "User deleted." });
}
