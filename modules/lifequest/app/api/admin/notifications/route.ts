import { NextResponse } from "next/server";
import { prisma } from "@lifequest/lib/prisma";
import { requireAdmin } from "@lifequest/lib/admin/auth";

export async function GET() {
  const { response } = await requireAdmin();
  if (response) return response;

  const subscriptions = await prisma.pushSubscription.findMany({
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
    },
  });

  return NextResponse.json({ subscriptions });
}
