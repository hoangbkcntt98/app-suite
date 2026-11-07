import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUserFromCookie } from "@lifequest/lib/auth";
import { randomUUID } from "node:crypto";
import { query } from "@lifequest/lib/db";

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const updateSettingsSchema = z.object({
  missionEnabled: z.boolean().optional(),
  missionTime: timeSchema.optional(),
  eventEnabled: z.boolean().optional(),
  eventTime: timeSchema.optional(),
});

async function getOrCreateSettings(userId: string) {
  const result = await query(
    `INSERT INTO notification_settings (id, "userId", "createdAt", "updatedAt")
     VALUES ($1, $2, NOW(), NOW())
     ON CONFLICT ("userId") DO UPDATE SET "userId" = EXCLUDED."userId"
     RETURNING *`,
    [randomUUID(), userId]
  );
  return result.rows[0];
}

export async function GET() {
  const authUser = await getCurrentUserFromCookie();

  if (!authUser) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const settings = await getOrCreateSettings(authUser.userId);

  return NextResponse.json({ settings });
}

export async function PATCH(request: NextRequest) {
  const authUser = await getCurrentUserFromCookie();

  if (!authUser) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = updateSettingsSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid notification settings." }, { status: 400 });
  }

  await getOrCreateSettings(authUser.userId);

  const fields = Object.entries(parsed.data);
  const assignments = fields.map(([field], index) => `"${field}" = $${index + 2}`);
  const settings = await query(
    `UPDATE notification_settings SET ${assignments.length ? `${assignments.join(", ")}, ` : ""}"updatedAt" = NOW()
     WHERE "userId" = $1 RETURNING *`,
    [authUser.userId, ...fields.map(([, value]) => value)]
  ).then((result) => result.rows[0]);

  return NextResponse.json({ settings });
}
