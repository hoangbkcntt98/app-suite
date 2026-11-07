import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { query } from "@lifequest/lib/db";
import { getCurrentUserFromCookie } from "@lifequest/lib/auth";

const subscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

export async function GET() {
  const authUser = await getCurrentUserFromCookie();

  if (!authUser) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM push_subscriptions WHERE "userId" = $1`,
    [authUser.userId]
  );
  const count = Number(countResult.rows[0]?.count ?? 0);

  return NextResponse.json({
    subscribed: count > 0,
    publicKey: process.env.LIFEQUEST_NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "",
  });
}

export async function POST(request: NextRequest) {
  const authUser = await getCurrentUserFromCookie();

  if (!authUser) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = subscriptionSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid push subscription." },
      { status: 400 }
    );
  }

  const subscription = parsed.data;

  await query(
    `INSERT INTO push_subscriptions (id, "userId", endpoint, p256dh, auth, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
     ON CONFLICT (endpoint) DO UPDATE SET
       "userId" = EXCLUDED."userId", p256dh = EXCLUDED.p256dh,
       auth = EXCLUDED.auth, "updatedAt" = NOW()`,
    [randomUUID(), authUser.userId, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth]
  );

  return NextResponse.json({ subscribed: true });
}

export async function DELETE(request: NextRequest) {
  const authUser = await getCurrentUserFromCookie();

  if (!authUser) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as
    | { endpoint?: string }
    | null;

  if (!body?.endpoint) {
    await query(`DELETE FROM push_subscriptions WHERE "userId" = $1`, [
      authUser.userId,
    ]);

    return NextResponse.json({ subscribed: false });
  }

  await query(
    `DELETE FROM push_subscriptions WHERE "userId" = $1 AND endpoint = $2`,
    [authUser.userId, body.endpoint]
  );

  return NextResponse.json({ subscribed: false });
}
