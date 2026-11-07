import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@lifequest/lib/admin/auth";
import { randomUUID } from "node:crypto";
import { query } from "@lifequest/lib/db";
import { DEFAULT_TEMPLATES, getPushTemplate } from "@lifequest/lib/notifications/templates";
import { type PushNotificationType } from "@lifequest/lib/notifications/templates";

const updateTemplateSchema = z.object({
  type: z.enum(["MISSION_DAILY", "EVENT_START"]),
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(500),
});

export async function GET() {
  const { response } = await requireAdmin();
  if (response) return response;

  await Promise.all(
    Object.keys(DEFAULT_TEMPLATES).map((type) =>
      getPushTemplate(type as PushNotificationType)
    )
  );

  const templates = await query(
    `SELECT * FROM push_notification_templates ORDER BY type ASC`
  ).then((result) => result.rows);

  return NextResponse.json({ templates });
}

export async function PATCH(request: NextRequest) {
  const { response } = await requireAdmin();
  if (response) return response;

  const body = await request.json().catch(() => null);
  const parsed = updateTemplateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid template data." }, { status: 400 });
  }

  const template = await query(
    `INSERT INTO push_notification_templates (id, type, title, body, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, NOW(), NOW())
     ON CONFLICT (type) DO UPDATE SET
       title = EXCLUDED.title, body = EXCLUDED.body, "updatedAt" = NOW()
     RETURNING *`,
    [randomUUID(), parsed.data.type, parsed.data.title, parsed.data.body]
  ).then((result) => result.rows[0]);

  return NextResponse.json({ template });
}
