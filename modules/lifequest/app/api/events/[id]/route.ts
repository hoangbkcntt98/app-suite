import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUserFromCookie } from "@lifequest/lib/auth";
import { parseDateOnlyUTC } from "@lifequest/lib/date";
import { prisma } from "@lifequest/lib/prisma";

const updateEventSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  location: z.string().max(160).optional().nullable(),
  content: z.string().max(1000).optional().nullable(),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional().nullable(),
});

export async function PATCH(
  request: NextRequest,
  context: RouteContext<"/lifequest/api/events/[id]">
) {
  const authUser = await getCurrentUserFromCookie();

  if (!authUser) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const parsed = updateEventSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid event data." }, { status: 400 });
  }

  const existing = await prisma.calendarEvent.findFirst({
    where: { id, userId: authUser.userId },
  });

  if (!existing) {
    return NextResponse.json({ message: "Event not found." }, { status: 404 });
  }

  const startDate = parsed.data.startDate
    ? parseDateOnlyUTC(parsed.data.startDate)
    : existing.startDate;
  const endDate =
    parsed.data.endDate === undefined
      ? existing.endDate
      : parsed.data.endDate
        ? parseDateOnlyUTC(parsed.data.endDate)
        : null;

  if (endDate && endDate < startDate) {
    return NextResponse.json(
      { message: "End date must be after start date." },
      { status: 400 }
    );
  }

  const event = await prisma.calendarEvent.update({
    where: { id },
    data: {
      ...parsed.data,
      startDate,
      endDate,
    },
  });

  return NextResponse.json({ event });
}

export async function DELETE(
  _request: NextRequest,
  context: RouteContext<"/lifequest/api/events/[id]">
) {
  const authUser = await getCurrentUserFromCookie();

  if (!authUser) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const { id } = await context.params;
  const existing = await prisma.calendarEvent.findFirst({
    where: { id, userId: authUser.userId },
  });

  if (!existing) {
    return NextResponse.json({ message: "Event not found." }, { status: 404 });
  }

  await prisma.calendarEvent.delete({ where: { id } });

  return NextResponse.json({ message: "Event deleted." });
}
