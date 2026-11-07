import { NextResponse } from "next/server";
import { query } from "@lifequest/lib/db";
import { requireAdmin } from "@lifequest/lib/admin/auth";

export async function GET() {
  const { response } = await requireAdmin();
  if (response) return response;

  const subscriptions = await query(
    `SELECT p.*, json_build_object('id', u.id, 'email', u.email) AS user
     FROM push_subscriptions p JOIN users u ON u.id = p."userId"
     ORDER BY p."createdAt" DESC`
  ).then((result) => result.rows);

  return NextResponse.json({ subscriptions });
}
