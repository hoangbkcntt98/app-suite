import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@lifequest/lib/prisma";
import { formatDateKey, getCurrentTimeInTokyoHHMM, getTodayInTokyoDateOnly } from "@lifequest/lib/date";
import { getTodayMissionSummary } from "@lifequest/lib/notifications/missions";
import { getPushTemplate, renderTemplate } from "@lifequest/lib/notifications/templates";
import { sendPushToSubscriptions } from "@lifequest/lib/notifications/web-push";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "");

  if (!process.env.LIFEQUEST_CRON_SECRET || token !== process.env.LIFEQUEST_CRON_SECRET) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  try {
    const currentTime = getCurrentTimeInTokyoHHMM();
    const today = getTodayInTokyoDateOnly();
    const todayKey = formatDateKey(today);

    const users = await prisma.user.findMany({
      where: {
        pushSubscriptions: {
          some: {},
        },
      },
      select: {
        id: true,
        email: true,
        pushSubscriptions: true,
        notificationSetting: true,
      },
    });

    let sent = 0;
    let failed = 0;
    let skipped = 0;

    const [missionTemplate, eventTemplate] = await Promise.all([
      getPushTemplate("MISSION_DAILY"),
      getPushTemplate("EVENT_START"),
    ]);

    for (const user of users) {
      const settings =
        user.notificationSetting ??
        (await prisma.notificationSetting.create({
          data: { userId: user.id },
        }));

      if (settings.missionEnabled && settings.missionTime === currentTime) {
        const delivered = await prisma.pushNotificationDelivery.findFirst({
          where: {
            userId: user.id,
            type: "MISSION_DAILY",
            targetDate: today,
            entityId: null,
          },
        });

        if (!delivered) {
          const summary = await getTodayMissionSummary(user.id);
          const title = renderTemplate(missionTemplate.title, {
            remaining: summary.remaining,
            completed: summary.completed,
            total: summary.total,
          });
          const body = renderTemplate(missionTemplate.body, {
            remaining: summary.remaining,
            completed: summary.completed,
            total: summary.total,
          });

          const result = await sendPushToSubscriptions(user.pushSubscriptions, {
            title,
            body,
            url: "/lifequest/dashboard",
          });
          sent += result.sent;
          failed += result.failed;

          await prisma.pushNotificationDelivery.create({
            data: {
              userId: user.id,
              type: "MISSION_DAILY",
              targetDate: today,
              entityId: null,
            },
          });
        }
      } else {
        skipped += 1;
      }

      if (settings.eventEnabled && settings.eventTime === currentTime) {
        const events = await prisma.calendarEvent.findMany({
          where: {
            userId: user.id,
            startDate: today,
          },
        });

        for (const event of events) {
          const delivered = await prisma.pushNotificationDelivery.findFirst({
            where: {
              userId: user.id,
              type: "EVENT_START",
              targetDate: today,
              entityId: event.id,
            },
          });

          if (delivered) continue;

          const title = renderTemplate(eventTemplate.title, {
            eventTitle: event.title,
            location: event.location || "chưa có địa điểm",
            date: todayKey,
          });
          const body = renderTemplate(eventTemplate.body, {
            eventTitle: event.title,
            location: event.location || "chưa có địa điểm",
            date: todayKey,
            content: event.content || "",
          });

          const result = await sendPushToSubscriptions(user.pushSubscriptions, {
            title,
            body,
            url: "/lifequest/calendar",
          });
          sent += result.sent;
          failed += result.failed;

          await prisma.pushNotificationDelivery.create({
            data: {
              userId: user.id,
              type: "EVENT_START",
              targetDate: today,
              entityId: event.id,
            },
          });
        }
      }
    }

    return NextResponse.json({
      users: users.length,
      currentTime,
      sent,
      failed,
      skipped,
    });
  } catch (error) {
    console.error("PUSH_DAILY_ERROR", error);

    return NextResponse.json(
      { message: "Internal server error." },
      { status: 500 }
    );
  }
}
