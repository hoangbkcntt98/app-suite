import { PushNotificationType } from "@prisma/client";
import { prisma } from "@lifequest/lib/prisma";

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
  const template = await prisma.pushNotificationTemplate.upsert({
    where: { type },
    update: {},
    create: {
      type,
      title: DEFAULT_TEMPLATES[type].title,
      body: DEFAULT_TEMPLATES[type].body,
    },
  });

  return template;
}

export { DEFAULT_TEMPLATES };
