import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { query } from "@lifequest/lib/db";
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

    const users = await query(
      `SELECT u.id, u.email,
        COALESCE((
          SELECT json_agg(json_build_object(
            'id', p.id, 'endpoint', p.endpoint, 'p256dh', p.p256dh, 'auth', p.auth
          )) FROM push_subscriptions p WHERE p."userId" = u.id
        ), '[]'::json) AS "pushSubscriptions",
        to_jsonb(ns) AS "notificationSetting"
       FROM users u
       LEFT JOIN notification_settings ns ON ns."userId" = u.id
       WHERE EXISTS (SELECT 1 FROM push_subscriptions p WHERE p."userId" = u.id)`
    ).then((result) => result.rows);

    let sent = 0;
    let failed = 0;
    let skipped = 0;

    const [missionTemplate, eventTemplate] = await Promise.all([
      getPushTemplate("MISSION_DAILY"),
      getPushTemplate("EVENT_START"),
    ]);

    for (const user of users) {
      const settings = user.notificationSetting ?? await query(
        `INSERT INTO notification_settings (id, "userId", "createdAt", "updatedAt")
         VALUES ($1, $2, NOW(), NOW()) RETURNING *`,
        [randomUUID(), user.id]
      ).then((result) => result.rows[0]);

      if (settings.missionEnabled && settings.missionTime === currentTime) {
        const delivery = await query(
          `SELECT id FROM push_notification_deliveries
           WHERE "userId" = $1 AND type = 'MISSION_DAILY' AND "targetDate" = $2 AND "entityId" IS NULL`,
          [user.id, today]
        );
        const delivered = delivery.rows[0];

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

          await query(
            `INSERT INTO push_notification_deliveries (id, "userId", type, "targetDate", "entityId", "createdAt")
             VALUES ($1, $2, 'MISSION_DAILY', $3, NULL, NOW())`,
            [randomUUID(), user.id, today]
          );
        }
      } else {
        skipped += 1;
      }

      if (settings.eventEnabled && settings.eventTime === currentTime) {
        const events = await query(
          `SELECT * FROM calendar_events WHERE "userId" = $1 AND "startDate" = $2`,
          [user.id, today]
        ).then((result) => result.rows);

        for (const event of events) {
          const delivery = await query(
            `SELECT id FROM push_notification_deliveries
             WHERE "userId" = $1 AND type = 'EVENT_START' AND "targetDate" = $2 AND "entityId" = $3`,
            [user.id, today, event.id]
          );
          const delivered = delivery.rows[0];

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

          await query(
            `INSERT INTO push_notification_deliveries (id, "userId", type, "targetDate", "entityId", "createdAt")
             VALUES ($1, $2, 'EVENT_START', $3, $4, NOW())`,
            [randomUUID(), user.id, today, event.id]
          );
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
