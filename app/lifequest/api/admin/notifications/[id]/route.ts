import { NextRequest, NextResponse } from "next/server";
import { query } from "@lifequest/lib/db";
import { requireAdmin } from "@lifequest/lib/admin/auth";

export async function DELETE(
  _request: NextRequest,
  context: RouteContext<"/lifequest/api/admin/notifications/[id]">
) {
  const { response } = await requireAdmin();
  if (response) return response;

  const { id } = await context.params;

  await query(`DELETE FROM push_subscriptions WHERE id = $1`, [id]);

  return NextResponse.json({ message: "Subscription deleted." });
}
