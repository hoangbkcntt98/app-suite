import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@lifequest/lib/prisma";
import { requireAdmin } from "@lifequest/lib/admin/auth";

export async function DELETE(
  _request: NextRequest,
  context: RouteContext<"/lifequest/api/admin/notifications/[id]">
) {
  const { response } = await requireAdmin();
  if (response) return response;

  const { id } = await context.params;

  await prisma.pushSubscription.delete({
    where: { id },
  });

  return NextResponse.json({ message: "Subscription deleted." });
}
