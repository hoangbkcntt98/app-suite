import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@lifequest/lib/db";
import { requireAdmin } from "@lifequest/lib/admin/auth";
import { sendPushToSubscriptions } from "@lifequest/lib/notifications/web-push";

const testNotificationSchema = z.object({
  userId: z.string().optional().nullable(),
  title: z.string().min(1).max(80).default("LifeQuest test notification"),
  body: z.string().min(1).max(240).default("Admin sent a test notification."),
  url: z.string().default("/lifequest/dashboard"),
});

export async function POST(request: NextRequest) {
  const { response } = await requireAdmin();
  if (response) return response;

  const body = await request.json().catch(() => null);
  const parsed = testNotificationSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid notification data." },
      { status: 400 }
    );
  }

  const subscriptions = await query<{
    id: string;
    endpoint: string;
    p256dh: string;
    auth: string;
  }>(
    `SELECT id, endpoint, p256dh, auth FROM push_subscriptions
     WHERE $1::text IS NULL OR "userId" = $1`,
    [parsed.data.userId ?? null]
  ).then((result) => result.rows);

  const result = await sendPushToSubscriptions(subscriptions, {
    title: parsed.data.title,
    body: parsed.data.body,
    url: parsed.data.url,
  });

  return NextResponse.json({
    subscriptions: subscriptions.length,
    ...result,
  });
}
