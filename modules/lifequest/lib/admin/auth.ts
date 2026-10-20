import { NextResponse } from "next/server";
import { prisma } from "@lifequest/lib/prisma";
import { getCurrentUserFromCookie } from "@lifequest/lib/auth";

export async function requireAdmin() {
  const authUser = await getCurrentUserFromCookie();

  if (!authUser) {
    return {
      user: null,
      response: NextResponse.json({ message: "Unauthorized." }, { status: 401 }),
    };
  }

  const user = await prisma.user.findUnique({
    where: {
      id: authUser.userId,
    },
    select: {
      id: true,
      email: true,
      role: true,
    },
  });

  if (!user || user.role !== "ADMIN") {
    return {
      user: null,
      response: NextResponse.json({ message: "Admin only." }, { status: 403 }),
    };
  }

  return {
    user,
    response: null,
  };
}
