import { randomUUID } from "node:crypto";
import { query } from "@lifequest/lib/db";

export type PushNotificationType = "MISSION_DAILY" | "EVENT_START";

const DEFAULT_TEMPLATES: Record<PushNotificationType, { title: string; body: string }> = {
  MISSION_DAILY: {
    title: "LifeQuest: {remaining} missions left",
    body: "Bạn còn {remaining}/{total} mission chưa làm hôm nay.",
  },
  EVENT_START: {
    title: "LifeQuest event: {eventTitle}",
    body: "Hôm nay có sự kiện {eventTitle} tại {location}.",
  },
};

export function renderTemplate(template: string, values: Record<string, string | number>) {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => {
    const value = values[key];
    return value === undefined || value === null ? match : String(value);
  });
}

export async function getPushTemplate(type: PushNotificationType) {
  const fallback = DEFAULT_TEMPLATES[type];
  const result = await query(
    `INSERT INTO push_notification_templates (id, type, title, body, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, NOW(), NOW())
     ON CONFLICT (type) DO UPDATE SET type = EXCLUDED.type
     RETURNING id, type, title, body, "createdAt", "updatedAt"`,
    [randomUUID(), type, fallback.title, fallback.body]
  );
  return result.rows[0];
}

export { DEFAULT_TEMPLATES };
