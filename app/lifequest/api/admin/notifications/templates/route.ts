import { NextRequest, NextResponse } from "next/server";
import { PushNotificationType } from "@prisma/client";
import { z } from "zod";
import { requireAdmin } from "@lifequest/lib/admin/auth";
import { prisma } from "@lifequest/lib/prisma";
import { DEFAULT_TEMPLATES, getPushTemplate } from "@lifequest/lib/notifications/templates";

const updateTemplateSchema = z.object({
  type: z.nativeEnum(PushNotificationType),
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

  const templates = await prisma.pushNotificationTemplate.findMany({
    orderBy: { type: "asc" },
  });

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

  const template = await prisma.pushNotificationTemplate.upsert({
    where: { type: parsed.data.type },
    update: {
      title: parsed.data.title,
      body: parsed.data.body,
    },
    create: parsed.data,
  });

  return NextResponse.json({ template });
}
