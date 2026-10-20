import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@lifequest/lib/prisma";
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

  const subscriptions = await prisma.pushSubscription.findMany({
    where: parsed.data.userId
      ? {
          userId: parsed.data.userId,
        }
      : undefined,
  });

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
