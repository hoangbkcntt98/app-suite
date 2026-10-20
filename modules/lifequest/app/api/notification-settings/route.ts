import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUserFromCookie } from "@lifequest/lib/auth";
import { prisma } from "@lifequest/lib/prisma";

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const updateSettingsSchema = z.object({
  missionEnabled: z.boolean().optional(),
  missionTime: timeSchema.optional(),
  eventEnabled: z.boolean().optional(),
  eventTime: timeSchema.optional(),
});

async function getOrCreateSettings(userId: string) {
  return prisma.notificationSetting.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });
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

  const settings = await prisma.notificationSetting.update({
    where: { userId: authUser.userId },
    data: parsed.data,
  });

  return NextResponse.json({ settings });
}
