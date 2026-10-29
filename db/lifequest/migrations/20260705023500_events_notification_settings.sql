DO $$ BEGIN
    CREATE TYPE "PushNotificationType" AS ENUM ('MISSION_DAILY', 'EVENT_START');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "calendar_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "location" TEXT,
    "content" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "notification_settings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "missionEnabled" BOOLEAN NOT NULL DEFAULT true,
    "missionTime" TEXT NOT NULL DEFAULT '20:00',
    "eventEnabled" BOOLEAN NOT NULL DEFAULT true,
    "eventTime" TEXT NOT NULL DEFAULT '09:00',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "push_notification_templates" (
    "id" TEXT NOT NULL,
    "type" "PushNotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "push_notification_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "push_notification_deliveries" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "PushNotificationType" NOT NULL,
    "targetDate" TIMESTAMP(3) NOT NULL,
    "entityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "push_notification_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "calendar_events_userId_idx" ON "calendar_events"("userId");
CREATE INDEX IF NOT EXISTS "calendar_events_startDate_idx" ON "calendar_events"("startDate");
CREATE UNIQUE INDEX IF NOT EXISTS "notification_settings_userId_key" ON "notification_settings"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "push_notification_templates_type_key" ON "push_notification_templates"("type");
CREATE INDEX IF NOT EXISTS "push_notification_deliveries_userId_idx" ON "push_notification_deliveries"("userId");
CREATE INDEX IF NOT EXISTS "push_notification_deliveries_targetDate_idx" ON "push_notification_deliveries"("targetDate");
CREATE UNIQUE INDEX IF NOT EXISTS "push_notification_deliveries_userId_type_targetDate_entityId_key" ON "push_notification_deliveries"("userId", "type", "targetDate", "entityId");

DO $$ BEGIN
  ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
  ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
  ALTER TABLE "push_notification_deliveries" ADD CONSTRAINT "push_notification_deliveries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

INSERT INTO "push_notification_templates" ("id", "type", "title", "body", "createdAt", "updatedAt") VALUES
  ('default_mission_daily_template', 'MISSION_DAILY', 'LifeQuest: {remaining} missions left', 'Bạn còn {remaining}/{total} mission chưa làm hôm nay.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('default_event_start_template', 'EVENT_START', 'LifeQuest event: {eventTitle}', 'Hôm nay có sự kiện {eventTitle} tại {location}.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;
